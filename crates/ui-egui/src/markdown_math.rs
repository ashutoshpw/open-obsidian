//! Bounded native rendering for the CommonMark math callback.

use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};

use eframe::egui::{self, Color32, TextureHandle, TextureOptions};
use latex_rust::{Dim, MathFont, MathStyle, PngOptions};

const MAX_MATH_FORMULAS_PER_PASS: usize = 32;
const MAX_MATH_EXPRESSION_BYTES: usize = 512;
const MAX_MATH_GROUP_DEPTH: usize = 48;
const MAX_MATH_FALLBACK_BYTES: usize = 2048;
const MAX_MATH_IMAGE_DIMENSION: u32 = 1024;
const MAX_MATH_IMAGE_PIXELS: usize = 256 * 1024;
const MAX_MATH_PNG_BYTES: usize = 1024 * 1024;
const MAX_MATH_CACHE_ENTRIES: usize = 64;
const MAX_MATH_CACHE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct FormulaKey {
    source: String,
    inline: bool,
    text_color: [u8; 4],
    font_size_px: u32,
}

#[derive(Clone)]
enum CachedFormula {
    Image {
        texture: TextureHandle,
        width: u32,
        height: u32,
    },
    Failed,
}

struct CacheEntry {
    formula: CachedFormula,
    rgba_bytes: usize,
}

#[derive(Default)]
pub(super) struct MathRendererCache {
    entries: HashMap<FormulaKey, CacheEntry>,
    least_recently_used: VecDeque<FormulaKey>,
    cached_rgba_bytes: usize,
    font: Option<MathFont>,
    font_load_attempted: bool,
    pass_number: Option<u64>,
    formulas_this_pass: usize,
}

pub(super) fn math_render_callback<'a>(
    renderer: &'a mut MathRendererCache,
) -> impl Fn(&mut egui::Ui, &str, bool) + 'a {
    let renderer = RefCell::new(renderer);
    move |ui, source, inline| renderer.borrow_mut().render(ui, source, inline)
}

impl MathRendererCache {
    fn render(&mut self, ui: &mut egui::Ui, source: &str, inline: bool) {
        let pass_number = ui.ctx().cumulative_pass_nr();
        if self.pass_number != Some(pass_number) {
            self.pass_number = Some(pass_number);
            self.formulas_this_pass = 0;
        }
        self.formulas_this_pass = self.formulas_this_pass.saturating_add(1);

        if self.formulas_this_pass > MAX_MATH_FORMULAS_PER_PASS {
            show_math_source(
                ui,
                source,
                inline,
                "Math preview limit reached for this UI pass; showing the source.",
            );
            return;
        }
        if !math_expression_within_bounds(source) {
            show_math_source(
                ui,
                source,
                inline,
                "Math expression exceeds the preview size or nesting limit; showing the source.",
            );
            return;
        }

        let text_color = ui.visuals().text_color().to_array();
        let pixels_per_point = ui.ctx().pixels_per_point().clamp(1.0, 4.0);
        let body_size = egui::TextStyle::Body.resolve(ui.style()).size;
        let style_scale = if inline { 1.0 } else { 1.15 };
        let font_size_px = (body_size * style_scale * pixels_per_point)
            .round()
            .clamp(8.0, 128.0) as u32;
        let key = FormulaKey {
            source: source.to_owned(),
            inline,
            text_color,
            font_size_px,
        };

        if let Some(cached) = self.get_cached(&key) {
            show_cached_formula(ui, source, inline, pixels_per_point, cached);
            return;
        }

        let rendered = {
            let font = self.math_font();
            font.and_then(|font| {
                render_formula_png(source, inline, font, font_size_px, text_color)
            })
        };

        let Some((png, width, height)) = rendered else {
            self.insert(key.clone(), CachedFormula::Failed, 0);
            show_math_source(
                ui,
                source,
                inline,
                "Math rendering failed or exceeded image limits; showing the source.",
            );
            return;
        };

        let decoded = image::load_from_memory_with_format(&png, image::ImageFormat::Png);
        let Ok(decoded) = decoded else {
            self.insert(key.clone(), CachedFormula::Failed, 0);
            show_math_source(
                ui,
                source,
                inline,
                "Math rendering failed or exceeded image limits; showing the source.",
            );
            return;
        };
        if decoded.width() != width || decoded.height() != height {
            self.insert(key.clone(), CachedFormula::Failed, 0);
            show_math_source(
                ui,
                source,
                inline,
                "Math rendering failed or exceeded image limits; showing the source.",
            );
            return;
        }

        let mut rgba = decoded.to_rgba8().into_raw();
        let expected_rgba_bytes = (width as usize)
            .checked_mul(height as usize)
            .and_then(|pixels| pixels.checked_mul(4));
        if expected_rgba_bytes != Some(rgba.len()) {
            self.insert(key.clone(), CachedFormula::Failed, 0);
            show_math_source(
                ui,
                source,
                inline,
                "Math rendering failed or exceeded image limits; showing the source.",
            );
            return;
        }
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[3] = ((u16::from(pixel[3]) * u16::from(text_color[3])) / 255) as u8;
        }
        let rgba_bytes = rgba.len();
        let texture = ui.ctx().load_texture(
            "markdown-math-preview",
            egui::ColorImage::from_rgba_unmultiplied(
                [width as usize, height as usize],
                &rgba,
            ),
            TextureOptions::LINEAR,
        );
        self.insert(
            key.clone(),
            CachedFormula::Image {
                texture,
                width,
                height,
            },
            rgba_bytes,
        );
        if let Some(cached) = self.get_cached(&key) {
            show_cached_formula(ui, source, inline, pixels_per_point, cached);
        }
    }

    fn math_font(&mut self) -> Option<&MathFont> {
        if !self.font_load_attempted {
            self.font_load_attempted = true;
            self.font = MathFont::stix_two_math().ok();
        }
        self.font.as_ref()
    }

    fn get_cached(&mut self, key: &FormulaKey) -> Option<CachedFormula> {
        let formula = self.entries.get(key)?.formula.clone();
        self.least_recently_used.retain(|candidate| candidate != key);
        self.least_recently_used.push_back(key.clone());
        Some(formula)
    }

    fn insert(&mut self, key: FormulaKey, formula: CachedFormula, rgba_bytes: usize) {
        if let Some(previous) = self.entries.remove(&key) {
            self.cached_rgba_bytes = self
                .cached_rgba_bytes
                .saturating_sub(previous.rgba_bytes);
            self.least_recently_used.retain(|candidate| candidate != &key);
        }

        while self.entries.len() >= MAX_MATH_CACHE_ENTRIES
            || self.cached_rgba_bytes.saturating_add(rgba_bytes) > MAX_MATH_CACHE_BYTES
        {
            let Some(oldest) = self.least_recently_used.pop_front() else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.cached_rgba_bytes = self
                    .cached_rgba_bytes
                    .saturating_sub(removed.rgba_bytes);
            }
        }

        self.cached_rgba_bytes = self.cached_rgba_bytes.saturating_add(rgba_bytes);
        self.least_recently_used.push_back(key.clone());
        self.entries.insert(
            key,
            CacheEntry {
                formula,
                rgba_bytes,
            },
        );
    }
}

fn render_formula_png(
    source: &str,
    inline: bool,
    font: &MathFont,
    font_size_px: u32,
    text_color: [u8; 4],
) -> Option<(Vec<u8>, u32, u32)> {
    let ast = latex_rust::parse(source).ok()?;
    let style = if inline {
        MathStyle::Text
    } else {
        MathStyle::Display
    };
    let layout = latex_rust::layout(&ast, font, style).ok()?;
    let font_size = Dim::from_i64(i64::from(font_size_px));
    let width = (&layout.width * &font_size).ceil_to_u32().ok()?;
    let total_height = &layout.height + &layout.depth;
    let height = (&total_height * &font_size).ceil_to_u32().ok()?;
    if !math_image_dimensions_within_bounds(width, height) {
        return None;
    }

    let options = PngOptions {
        font_size_pt: font_size,
        dpi: Dim::from_i64(72),
        color: latex_rust::Color::rgb(text_color[0], text_color[1], text_color[2]),
        background: latex_rust::PngBackground::Transparent,
        display: !inline,
    };
    let png = latex_rust::render_png(&layout, font, &options).ok()?;
    if png.len() > MAX_MATH_PNG_BYTES || png_dimensions(&png) != Some((width, height)) {
        return None;
    }
    Some((png, width, height))
}

fn math_expression_within_bounds(source: &str) -> bool {
    if source.len() > MAX_MATH_EXPRESSION_BYTES {
        return false;
    }

    let mut depth = 0usize;
    let mut backslashes = 0usize;
    for byte in source.bytes() {
        if byte == b'\\' {
            backslashes += 1;
            continue;
        }
        if backslashes % 2 == 0 {
            match byte {
                b'{' => {
                    depth += 1;
                    if depth > MAX_MATH_GROUP_DEPTH {
                        return false;
                    }
                }
                b'}' => depth = depth.saturating_sub(1),
                _ => {}
            }
        }
        backslashes = 0;
    }
    true
}

fn math_image_dimensions_within_bounds(width: u32, height: u32) -> bool {
    if width == 0
        || height == 0
        || width > MAX_MATH_IMAGE_DIMENSION
        || height > MAX_MATH_IMAGE_DIMENSION
    {
        return false;
    }
    (width as usize)
        .checked_mul(height as usize)
        .is_some_and(|pixels| pixels <= MAX_MATH_IMAGE_PIXELS)
}

fn png_dimensions(png: &[u8]) -> Option<(u32, u32)> {
    if png.len() < 24
        || png.len() > MAX_MATH_PNG_BYTES
        || !png.starts_with(b"\x89PNG\r\n\x1a\n")
        || &png[12..16] != b"IHDR"
    {
        return None;
    }
    let width = u32::from_be_bytes(png[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(png[20..24].try_into().ok()?);
    math_image_dimensions_within_bounds(width, height).then_some((width, height))
}

fn show_cached_formula(
    ui: &mut egui::Ui,
    source: &str,
    inline: bool,
    pixels_per_point: f32,
    cached: CachedFormula,
) {
    match cached {
        CachedFormula::Image {
            texture,
            width,
            height,
        } => {
            let size = egui::vec2(
                width as f32 / pixels_per_point,
                height as f32 / pixels_per_point,
            );
            ui.add(
                egui::Image::new(&texture)
                    .fit_to_exact_size(size)
                    .alt_text(format!("Rendered math formula: {source}")),
            );
        }
        CachedFormula::Failed => show_math_source(
            ui,
            source,
            inline,
            "Math rendering failed or exceeded image limits; showing the source.",
        ),
    }
}

fn show_math_source(ui: &mut egui::Ui, source: &str, inline: bool, message: &str) {
    ui.colored_label(Color32::YELLOW, message);
    let mut end = source.len().min(MAX_MATH_FALLBACK_BYTES);
    while !source.is_char_boundary(end) {
        end -= 1;
    }
    let truncated = end < source.len();
    let source = &source[..end];
    if inline {
        ui.monospace(format!("${source}$"));
    } else {
        ui.monospace(format!("$$\n{source}\n$$"));
    }
    if truncated {
        ui.small("Math source preview shortened; the original Markdown remains unchanged.");
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CachedFormula, FormulaKey, MAX_MATH_CACHE_ENTRIES, MathRendererCache,
        math_expression_within_bounds, math_image_dimensions_within_bounds, png_dimensions,
    };

    const LATEX_RUST_NOTICE: &str =
        include_str!("../../../licenses/latex-rust/NOTICE.txt");
    const STIX_TWO_MATH_OFL: &str =
        include_str!("../../../licenses/latex-rust/STIX-Two-Math-OFL-1.1.txt");

    #[test]
    fn math_expression_bounds_reject_long_and_deep_input_but_allow_escaped_braces() {
        assert!(math_expression_within_bounds(r"\{x\}"));
        assert!(!math_expression_within_bounds(&"x".repeat(513)));
        let nested = format!("{}x{}", "{".repeat(49), "}".repeat(49));
        assert!(!math_expression_within_bounds(&nested));
    }

    #[test]
    fn math_image_bounds_reject_empty_oversized_and_excess_pixel_rasters() {
        assert!(!math_image_dimensions_within_bounds(0, 1));
        assert!(!math_image_dimensions_within_bounds(1025, 1));
        assert!(!math_image_dimensions_within_bounds(1024, 1024));
        assert!(math_image_dimensions_within_bounds(512, 512));
    }

    #[test]
    fn png_dimensions_require_a_bounded_png_ihdr() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x10\0\0\0\x08".to_vec();
        assert_eq!(png_dimensions(&png), Some((16, 8)));
        png[16..20].copy_from_slice(&1025_u32.to_be_bytes());
        assert_eq!(png_dimensions(&png), None);
    }

    #[test]
    fn math_texture_cache_evicts_old_entries_at_its_entry_bound() {
        let mut cache = MathRendererCache::default();
        for index in 0..(MAX_MATH_CACHE_ENTRIES + 1) {
            let key = FormulaKey {
                source: index.to_string(),
                inline: true,
                text_color: [0, 0, 0, 255],
                font_size_px: 16,
            };
            cache.insert(key, CachedFormula::Failed, 0);
        }
        assert_eq!(cache.entries.len(), MAX_MATH_CACHE_ENTRIES);
        assert_eq!(cache.least_recently_used.len(), MAX_MATH_CACHE_ENTRIES);
    }

    #[test]
    fn runtime_math_renderer_notice_includes_the_crate_and_embedded_font_attribution() {
        assert!(LATEX_RUST_NOTICE.contains("LaTeX-Rust"));
        assert!(LATEX_RUST_NOTICE.contains("Copyright 2026 Jeffrey S Carr"));
        assert!(STIX_TWO_MATH_OFL.contains("STIX Fonts Project Authors"));
        assert!(STIX_TWO_MATH_OFL.contains("SIL OPEN FONT LICENSE Version 1.1"));
        assert!(STIX_TWO_MATH_OFL.contains("TERMINATION"));
        assert!(STIX_TWO_MATH_OFL.contains("DISCLAIMER"));
    }
}
