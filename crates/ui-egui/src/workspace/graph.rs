//! Read-only graph view: pure filters and layouts plus an egui painter widget.
//!
//! The graph is derived by the engine; this module never writes to the vault. Clicking a note
//! node yields [`WorkspaceAction::OpenNote`]; clicking an unresolved `?target` node yields
//! [`WorkspaceAction::CreateNoteAt`] so the host can offer to create it. A list view offers a
//! keyboard-accessible alternative to the canvas.

use super::WorkspaceAction;
use eframe::egui;
use openobsidian_engine::{Graph, GraphNodeKind};
use std::collections::VecDeque;

/// Available layout algorithms.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GraphLayoutKind {
    Force,
    Hierarchical,
    Radial,
}

impl GraphLayoutKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Force => "Force",
            Self::Hierarchical => "Hierarchical",
            Self::Radial => "Radial",
        }
    }
}

/// Graph filters. Defaults show everything.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GraphFilter {
    /// Case-insensitive substring of the node id; empty matches all.
    pub search: String,
    /// Folder prefix (`"Projects"`); empty matches all. Unresolved nodes never match a folder.
    pub folder: String,
    pub show_unresolved: bool,
    pub show_attachments: bool,
    pub show_orphans: bool,
    /// When set, only nodes within `depth` undirected hops of this node are kept.
    pub local_center: Option<String>,
    pub depth: usize,
}

impl Default for GraphFilter {
    fn default() -> Self {
        Self {
            search: String::new(),
            folder: String::new(),
            show_unresolved: true,
            show_attachments: true,
            show_orphans: true,
            local_center: None,
            depth: 1,
        }
    }
}

/// Folder part of a node id (`"a/b/c.md"` gives `"a/b"`, root notes give `""`).
pub fn node_folder(id: &str) -> &str {
    match id.rsplit_once('/') {
        Some((folder, _)) => folder,
        None => "",
    }
}

/// Top-level folder of a node id, used for color groups (`""` for root notes).
pub fn node_group(id: &str) -> &str {
    match id.split_once('/') {
        Some((top, _)) => top,
        None => "",
    }
}

fn degrees(graph: &Graph) -> Vec<usize> {
    let mut result = vec![0usize; graph.nodes.len()];
    for edge in &graph.edges {
        if let Ok(i) = graph.nodes.binary_search_by(|n| n.id.cmp(&edge.source)) {
            result[i] += 1;
        }
        if let Ok(i) = graph.nodes.binary_search_by(|n| n.id.cmp(&edge.target)) {
            result[i] += 1;
        }
    }
    result
}

fn local_ids(graph: &Graph, center: &str, depth: usize) -> Vec<String> {
    let mut seen: Vec<String> = vec![center.to_owned()];
    let mut frontier: Vec<String> = vec![center.to_owned()];
    for _ in 0..depth {
        let mut next = Vec::new();
        for edge in &graph.edges {
            let source_in = frontier.contains(&edge.source);
            let target_in = frontier.contains(&edge.target);
            if source_in && !seen.contains(&edge.target) {
                seen.push(edge.target.clone());
                next.push(edge.target.clone());
            }
            if target_in && !seen.contains(&edge.source) {
                seen.push(edge.source.clone());
                next.push(edge.source.clone());
            }
        }
        if next.is_empty() {
            break;
        }
        frontier = next;
    }
    seen
}

/// Applies `filter` and returns the visible subgraph (nodes stay sorted by id).
pub fn filter_graph(graph: &Graph, filter: &GraphFilter) -> Graph {
    let local = filter
        .local_center
        .as_deref()
        .map(|center| local_ids(graph, center, filter.depth));
    let degree = degrees(graph);
    let search = filter.search.to_lowercase();
    let folder = filter.folder.trim_matches('/');
    let folder_prefix = format!("{folder}/");
    let mut nodes = Vec::new();
    for (index, node) in graph.nodes.iter().enumerate() {
        if let Some(ids) = &local
            && !ids.contains(&node.id)
        {
            continue;
        }
        match node.kind {
            GraphNodeKind::Unresolved if !filter.show_unresolved => continue,
            GraphNodeKind::Attachment if !filter.show_attachments => continue,
            _ => {}
        }
        if !filter.show_orphans && degree[index] == 0 {
            continue;
        }
        if !search.is_empty() && !node.id.to_lowercase().contains(&search) {
            continue;
        }
        if !folder.is_empty() {
            let in_folder =
                node.kind != GraphNodeKind::Unresolved && node.id.starts_with(&folder_prefix);
            if !in_folder {
                continue;
            }
        }
        nodes.push(node.clone());
    }
    let edges = graph
        .edges
        .iter()
        .filter(|edge| {
            nodes.binary_search_by(|n| n.id.cmp(&edge.source)).is_ok()
                && nodes.binary_search_by(|n| n.id.cmp(&edge.target)).is_ok()
        })
        .cloned()
        .collect();
    Graph { nodes, edges }
}

/// Edges as index pairs into `graph.nodes`.
pub fn edge_indices(graph: &Graph) -> Vec<(usize, usize)> {
    graph
        .edges
        .iter()
        .filter_map(|edge| {
            let a = graph
                .nodes
                .binary_search_by(|n| n.id.cmp(&edge.source))
                .ok()?;
            let b = graph
                .nodes
                .binary_search_by(|n| n.id.cmp(&edge.target))
                .ok()?;
            Some((a, b))
        })
        .collect()
}

/// Deterministic starting positions on a spiral.
pub fn initial_positions(count: usize, seed: u32) -> Vec<egui::Pos2> {
    (0..count)
        .map(|i| {
            let radius = 30.0 * ((i + 1) as f32).sqrt();
            let angle = i as f32 * 2.399_963 + seed as f32 * 0.37;
            egui::pos2(radius * angle.cos(), radius * angle.sin())
        })
        .collect()
}

/// One force-directed step (Fruchterman-Reingold). Returns the largest displacement.
#[allow(clippy::needless_range_loop)]
pub fn force_step(
    positions: &mut [egui::Pos2],
    edges: &[(usize, usize)],
    ideal: f32,
    max_move: f32,
) -> f32 {
    let n = positions.len();
    let mut delta = vec![egui::Vec2::ZERO; n];
    for i in 0..n {
        for j in (i + 1)..n {
            let mut d = positions[i] - positions[j];
            let mut dist = d.length();
            if dist < 0.01 {
                d = egui::vec2(1.0, 0.0);
                dist = 0.01;
            }
            let push = d / dist * (ideal * ideal / dist);
            delta[i] += push;
            delta[j] -= push;
        }
    }
    for &(a, b) in edges {
        if a == b {
            continue;
        }
        let d = positions[a] - positions[b];
        let dist = d.length().max(0.01);
        let pull = d / dist * (dist * dist / ideal);
        delta[a] -= pull;
        delta[b] += pull;
    }
    let mut largest = 0.0f32;
    for (position, d) in positions.iter_mut().zip(delta) {
        let length = d.length();
        if length > 0.0 {
            let step = d / length * length.min(max_move);
            *position += step;
            largest = largest.max(step.length());
        }
    }
    largest
}

/// Deterministic force layout; step count shrinks for large graphs.
pub fn layout_force(count: usize, edges: &[(usize, usize)], seed: u32) -> Vec<egui::Pos2> {
    let mut positions = initial_positions(count, seed);
    if count < 2 {
        return positions;
    }
    let steps = (30_000_000 / (count * count)).clamp(5, 300);
    let ideal = 60.0;
    for step in 0..steps {
        let cooling = 1.0 - step as f32 / steps as f32;
        let moved = force_step(&mut positions, edges, ideal, (ideal * cooling).max(1.0));
        if moved < 0.05 {
            break;
        }
    }
    for position in &mut positions {
        position.x = position.x.clamp(-FORCE_LAYOUT_EXTENT, FORCE_LAYOUT_EXTENT);
        position.y = position.y.clamp(-FORCE_LAYOUT_EXTENT, FORCE_LAYOUT_EXTENT);
    }
    positions
}

/// Force layouts are clamped to this distance from the origin on each axis.
const FORCE_LAYOUT_EXTENT: f32 = 1_000.0;

/// Layer (depth) per node following edge direction from roots (nodes without incoming edges).
pub fn layers(count: usize, edges: &[(usize, usize)]) -> Vec<usize> {
    let mut incoming = vec![0usize; count];
    let mut outgoing: Vec<Vec<usize>> = vec![Vec::new(); count];
    for &(a, b) in edges {
        if a != b {
            incoming[b] += 1;
            outgoing[a].push(b);
        }
    }
    let mut layer = vec![usize::MAX; count];
    let mut queue = VecDeque::new();
    loop {
        let root = (0..count)
            .find(|&i| layer[i] == usize::MAX && incoming[i] == 0)
            .or_else(|| (0..count).find(|&i| layer[i] == usize::MAX));
        let Some(root) = root else {
            break;
        };
        layer[root] = 0;
        queue.push_back(root);
        while let Some(current) = queue.pop_front() {
            for &next in &outgoing[current] {
                if layer[next] == usize::MAX {
                    layer[next] = layer[current] + 1;
                    queue.push_back(next);
                }
            }
        }
    }
    layer
}

fn members_by_layer(layer: &[usize]) -> Vec<Vec<usize>> {
    let depth = layer.iter().copied().max().map_or(0, |max| max + 1);
    let mut rows = vec![Vec::new(); depth];
    for (index, &value) in layer.iter().enumerate() {
        rows[value].push(index);
    }
    rows
}

/// Top-down layered layout.
pub fn layout_hierarchical(count: usize, edges: &[(usize, usize)]) -> Vec<egui::Pos2> {
    let layer = layers(count, edges);
    let mut positions = vec![egui::Pos2::ZERO; count];
    for (row, members) in members_by_layer(&layer).iter().enumerate() {
        let width = (members.len() as f32 - 1.0) * 80.0;
        for (slot, &index) in members.iter().enumerate() {
            positions[index] = egui::pos2(slot as f32 * 80.0 - width / 2.0, row as f32 * 90.0);
        }
    }
    positions
}

/// Concentric rings by layer around the origin.
pub fn layout_radial(count: usize, edges: &[(usize, usize)]) -> Vec<egui::Pos2> {
    let layer = layers(count, edges);
    let mut positions = vec![egui::Pos2::ZERO; count];
    for (ring, members) in members_by_layer(&layer).iter().enumerate() {
        if ring == 0 && members.len() == 1 {
            continue;
        }
        let radius = (ring as f32).max(1.0) * 90.0;
        let radius = radius.max(members.len() as f32 * 40.0 / std::f32::consts::TAU);
        for (slot, &index) in members.iter().enumerate() {
            let angle = std::f32::consts::TAU * slot as f32 / members.len() as f32;
            positions[index] = egui::pos2(radius * angle.cos(), radius * angle.sin());
        }
    }
    positions
}

/// Computes positions for `graph` using `kind`.
pub fn compute_layout(graph: &Graph, kind: GraphLayoutKind) -> Vec<egui::Pos2> {
    let edges = edge_indices(graph);
    let count = graph.nodes.len();
    match kind {
        GraphLayoutKind::Force => layout_force(count, &edges, 1),
        GraphLayoutKind::Hierarchical => layout_hierarchical(count, &edges),
        GraphLayoutKind::Radial => layout_radial(count, &edges),
    }
}

/// Index of the node whose center is nearest to `point` within `radius`.
pub fn hit_test(positions: &[egui::Pos2], point: egui::Pos2, radius: f32) -> Option<usize> {
    let mut best: Option<(usize, f32)> = None;
    for (index, position) in positions.iter().enumerate() {
        let dist = (*position - point).length();
        if dist <= radius && best.is_none_or(|(_, current)| dist < current) {
            best = Some((index, dist));
        }
    }
    best.map(|(index, _)| index)
}

/// Action produced by activating a node.
pub fn node_action(id: &str, kind: GraphNodeKind) -> Option<WorkspaceAction> {
    match kind {
        GraphNodeKind::File => Some(WorkspaceAction::OpenNote(id.to_owned())),
        GraphNodeKind::Unresolved => {
            let target = id.trim_start_matches('?');
            let path = if target.ends_with(".md") {
                target.to_owned()
            } else {
                format!("{target}.md")
            };
            Some(WorkspaceAction::CreateNoteAt(path))
        }
        GraphNodeKind::Attachment => None,
    }
}

const GROUP_COLORS: [egui::Color32; 6] = [
    egui::Color32::from_rgb(110, 150, 230),
    egui::Color32::from_rgb(230, 140, 90),
    egui::Color32::from_rgb(120, 200, 130),
    egui::Color32::from_rgb(200, 120, 200),
    egui::Color32::from_rgb(220, 200, 90),
    egui::Color32::from_rgb(90, 200, 210),
];

/// Stable color for a folder group.
pub fn group_color(id: &str) -> egui::Color32 {
    let group = node_group(id);
    if group.is_empty() {
        return egui::Color32::from_gray(170);
    }
    let hash = group.bytes().fold(0usize, |acc, b| {
        acc.wrapping_mul(31).wrapping_add(usize::from(b))
    });
    GROUP_COLORS[hash % GROUP_COLORS.len()]
}

const NODE_RADIUS: f32 = 6.0;
const LABEL_CAP: usize = 200;

/// Graph view state. Feed it the engine graph with [`GraphView::set_graph`], then call
/// [`GraphView::show`] each frame.
#[derive(Clone, Debug)]
pub struct GraphView {
    pub filter: GraphFilter,
    pub layout: GraphLayoutKind,
    pub show_list: bool,
    pub pan: egui::Vec2,
    pub zoom: f32,
    pub selected: Option<usize>,
    source: Graph,
    visible: Graph,
    positions: Vec<egui::Pos2>,
    applied: Option<(GraphFilter, GraphLayoutKind)>,
    need_fit: bool,
}

impl Default for GraphView {
    fn default() -> Self {
        Self {
            filter: GraphFilter::default(),
            layout: GraphLayoutKind::Force,
            show_list: false,
            pan: egui::Vec2::ZERO,
            zoom: 1.0,
            selected: None,
            source: Graph::default(),
            visible: Graph::default(),
            positions: Vec::new(),
            applied: None,
            need_fit: true,
        }
    }
}

impl GraphView {
    pub fn new() -> Self {
        Self::default()
    }

    /// Replaces the source graph; the layout is recomputed on the next frame.
    pub fn set_graph(&mut self, graph: Graph) {
        self.source = graph;
        self.applied = None;
    }

    /// Shows only `path` and its neighbours within `depth` hops (the local graph); `None`
    /// returns to the global graph.
    pub fn set_local(&mut self, path: Option<String>, depth: usize) {
        self.filter.local_center = path;
        self.filter.depth = depth.max(1);
    }

    /// Currently visible (filtered) graph.
    pub fn visible(&self) -> &Graph {
        &self.visible
    }

    /// Node positions in world space, parallel to `visible().nodes`.
    pub fn positions(&self) -> &[egui::Pos2] {
        &self.positions
    }

    /// Recomputes filter and layout when inputs changed. Returns true when it did.
    pub fn refresh(&mut self) -> bool {
        let key = (self.filter.clone(), self.layout);
        if self.applied.as_ref() == Some(&key) {
            return false;
        }
        self.visible = filter_graph(&self.source, &self.filter);
        self.positions = compute_layout(&self.visible, self.layout);
        self.selected = None;
        self.applied = Some(key);
        self.need_fit = true;
        true
    }

    fn fit(&mut self, size: egui::Vec2) {
        self.need_fit = false;
        let Some(first) = self.positions.first().copied() else {
            self.pan = egui::Vec2::ZERO;
            self.zoom = 1.0;
            return;
        };
        let mut rect = egui::Rect::from_min_max(first, first);
        for position in &self.positions {
            rect.extend_with(*position);
        }
        let width = rect.width().max(1.0) + 80.0;
        let height = rect.height().max(1.0) + 80.0;
        self.zoom = (size.x / width).min(size.y / height).clamp(0.05, 2.0);
        self.pan = -rect.center().to_vec2() * self.zoom;
    }

    fn controls(&mut self, ui: &mut egui::Ui) {
        ui.horizontal_wrapped(|ui| {
            ui.label("Search");
            ui.text_edit_singleline(&mut self.filter.search);
            ui.label("Folder");
            ui.text_edit_singleline(&mut self.filter.folder);
            egui::ComboBox::from_label("Layout")
                .selected_text(self.layout.label())
                .show_ui(ui, |ui| {
                    for kind in [
                        GraphLayoutKind::Force,
                        GraphLayoutKind::Hierarchical,
                        GraphLayoutKind::Radial,
                    ] {
                        ui.selectable_value(&mut self.layout, kind, kind.label());
                    }
                });
        });
        ui.horizontal_wrapped(|ui| {
            ui.checkbox(&mut self.filter.show_unresolved, "Unresolved");
            ui.checkbox(&mut self.filter.show_attachments, "Attachments");
            ui.checkbox(&mut self.filter.show_orphans, "Orphans");
            ui.checkbox(&mut self.show_list, "List view");
            if self.filter.local_center.is_some() {
                ui.label("Depth");
                ui.add(egui::DragValue::new(&mut self.filter.depth).range(1..=6));
            }
            if ui.button("Zoom in").clicked() {
                self.zoom = (self.zoom * 1.25).min(8.0);
            }
            if ui.button("Zoom out").clicked() {
                self.zoom = (self.zoom / 1.25).max(0.05);
            }
            if ui.button("Fit").clicked() {
                self.need_fit = true;
            }
        });
    }

    /// Draws controls plus the canvas (or the list) and returns the activated node's action.
    pub fn show(&mut self, ui: &mut egui::Ui) -> Option<WorkspaceAction> {
        self.controls(ui);
        self.refresh();
        ui.weak(format!(
            "{} nodes, {} links",
            self.visible.nodes.len(),
            self.visible.edges.len()
        ));
        if self.show_list {
            self.show_list_view(ui)
        } else {
            self.show_canvas(ui)
        }
    }

    fn show_list_view(&mut self, ui: &mut egui::Ui) -> Option<WorkspaceAction> {
        let degree = degrees(&self.visible);
        let mut action = None;
        egui::ScrollArea::vertical()
            .id_salt("openobsidian-graph-list")
            .show(ui, |ui| {
                for (index, node) in self.visible.nodes.iter().enumerate() {
                    let text = format!("{} ({} links)", node.id, degree[index]);
                    let response = ui.selectable_label(self.selected == Some(index), text);
                    if response.clicked() {
                        self.selected = Some(index);
                        action = node_action(&node.id, node.kind);
                    }
                }
            });
        action
    }

    fn show_canvas(&mut self, ui: &mut egui::Ui) -> Option<WorkspaceAction> {
        let size = ui.available_size().max(egui::vec2(50.0, 50.0));
        let (response, painter) = ui.allocate_painter(size, egui::Sense::click_and_drag());
        let rect = response.rect;
        if self.need_fit {
            self.fit(rect.size());
        }
        if response.dragged() {
            self.pan += response.drag_delta();
        }
        if response.hovered() {
            let factor = ui.input(|input| input.zoom_delta());
            if factor != 1.0 {
                self.zoom = (self.zoom * factor).clamp(0.05, 8.0);
            }
        }
        let origin = rect.center() + self.pan;
        let zoom = self.zoom;
        let screen: Vec<egui::Pos2> = self
            .positions
            .iter()
            .map(|p| origin + p.to_vec2() * zoom)
            .collect();
        let hovered = response
            .hover_pos()
            .and_then(|pointer| hit_test(&screen, pointer, NODE_RADIUS + 3.0));
        let background = ui.visuals().extreme_bg_color;
        let line = egui::Stroke::new(1.0, ui.visuals().weak_text_color());
        let text_color = ui.visuals().text_color();
        let accent = ui.visuals().selection.bg_fill;
        painter.rect_filled(rect, 0.0, background);
        for (a, b) in edge_indices(&self.visible) {
            painter.line_segment([screen[a], screen[b]], line);
        }
        let labels = self.visible.nodes.len() <= LABEL_CAP || zoom > 1.5;
        for (index, node) in self.visible.nodes.iter().enumerate() {
            let center = screen[index];
            if !rect.expand(20.0).contains(center) {
                continue;
            }
            let color = match node.kind {
                GraphNodeKind::Unresolved => egui::Color32::from_gray(120),
                _ => group_color(&node.id),
            };
            painter.circle_filled(center, NODE_RADIUS, color);
            if self.selected == Some(index) || hovered == Some(index) {
                painter.circle_stroke(center, NODE_RADIUS + 2.0, egui::Stroke::new(2.0, accent));
            }
            if labels || hovered == Some(index) {
                painter.text(
                    center + egui::vec2(0.0, NODE_RADIUS + 2.0),
                    egui::Align2::CENTER_TOP,
                    node.id.as_str(),
                    egui::FontId::proportional(11.0),
                    text_color,
                );
            }
        }
        if response.clicked() {
            let hit = response
                .interact_pointer_pos()
                .and_then(|pointer| hit_test(&screen, pointer, NODE_RADIUS + 3.0));
            self.selected = hit;
            if let Some(index) = hit {
                let node = &self.visible.nodes[index];
                return node_action(&node.id, node.kind);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use openobsidian_engine::{GraphEdge, GraphEdgeKind, GraphNode};

    fn node(id: &str, kind: GraphNodeKind) -> GraphNode {
        GraphNode {
            id: id.to_owned(),
            kind,
        }
    }

    fn edge(source: &str, target: &str) -> GraphEdge {
        GraphEdge {
            source: source.to_owned(),
            target: target.to_owned(),
            kind: GraphEdgeKind::Link,
        }
    }

    fn sample() -> Graph {
        let mut nodes = vec![
            node("Home.md", GraphNodeKind::File),
            node("Ideas.md", GraphNodeKind::File),
            node("Projects/Alpha.md", GraphNodeKind::File),
            node("Lonely.md", GraphNodeKind::File),
            node("?Missing", GraphNodeKind::Unresolved),
            node("img.png", GraphNodeKind::Attachment),
        ];
        nodes.sort();
        let mut edges = vec![
            edge("Home.md", "Projects/Alpha.md"),
            edge("Home.md", "Ideas.md"),
            edge("Ideas.md", "Home.md"),
            edge("Projects/Alpha.md", "?Missing"),
            edge("Home.md", "img.png"),
        ];
        edges.sort();
        Graph { nodes, edges }
    }

    fn ids(graph: &Graph) -> Vec<&str> {
        graph.nodes.iter().map(|n| n.id.as_str()).collect()
    }

    #[test]
    fn filters_unresolved_orphans_and_search() {
        let graph = sample();
        let all = filter_graph(&graph, &GraphFilter::default());
        assert_eq!(all.nodes.len(), 6);
        assert_eq!(all.edges.len(), 5);

        let filter = GraphFilter {
            show_unresolved: false,
            show_orphans: false,
            show_attachments: false,
            ..GraphFilter::default()
        };
        let visible = filter_graph(&graph, &filter);
        assert_eq!(ids(&visible), ["Home.md", "Ideas.md", "Projects/Alpha.md"]);
        assert_eq!(visible.edges.len(), 3);

        let filter = GraphFilter {
            search: "ALPHA".to_owned(),
            ..GraphFilter::default()
        };
        let visible = filter_graph(&graph, &filter);
        assert_eq!(ids(&visible), ["Projects/Alpha.md"]);
        assert!(visible.edges.is_empty());
    }

    #[test]
    fn filters_by_folder_and_local_depth() {
        let graph = sample();
        let filter = GraphFilter {
            folder: "Projects/".to_owned(),
            ..GraphFilter::default()
        };
        assert_eq!(ids(&filter_graph(&graph, &filter)), ["Projects/Alpha.md"]);

        let mut filter = GraphFilter {
            local_center: Some("Projects/Alpha.md".to_owned()),
            depth: 1,
            ..GraphFilter::default()
        };
        assert_eq!(
            ids(&filter_graph(&graph, &filter)),
            ["?Missing", "Home.md", "Projects/Alpha.md"]
        );
        filter.depth = 2;
        assert_eq!(filter_graph(&graph, &filter).nodes.len(), 5);
    }

    #[test]
    fn force_layout_is_deterministic_finite_and_bounded() {
        let graph = sample();
        let a = compute_layout(&graph, GraphLayoutKind::Force);
        let b = compute_layout(&graph, GraphLayoutKind::Force);
        assert_eq!(a, b);
        assert_eq!(a.len(), graph.nodes.len());
        for p in &a {
            assert!(p.x.is_finite() && p.y.is_finite());
            assert!(p.x.abs() < 2000.0 && p.y.abs() < 2000.0);
        }
    }

    #[test]
    fn force_steps_respect_the_move_bound() {
        let graph = sample();
        let edges = edge_indices(&graph);
        let mut positions = initial_positions(graph.nodes.len(), 1);
        for _ in 0..50 {
            let moved = force_step(&mut positions, &edges, 60.0, 0.5);
            assert!(moved <= 0.5 + 1e-4);
        }
        assert!(positions.iter().all(|p| p.x.is_finite() && p.y.is_finite()));
    }

    #[test]
    fn hierarchical_layers_follow_edges() {
        let edges = [(0, 1), (0, 2), (1, 3)];
        let layer = layers(4, &edges);
        assert_eq!(layer, [0, 1, 1, 2]);
        let positions = layout_hierarchical(4, &edges);
        assert!(positions[3].y > positions[1].y);
        assert_eq!(positions[1].y, positions[2].y);
        assert_eq!(layout_hierarchical(4, &edges), positions);
    }

    #[test]
    fn layers_cover_cycles() {
        let layer = layers(3, &[(0, 1), (1, 2), (2, 0)]);
        assert!(layer.iter().all(|&l| l != usize::MAX));
    }

    #[test]
    fn radial_layout_puts_layers_on_rings() {
        let edges = [(0, 1), (0, 2), (1, 3)];
        let positions = layout_radial(4, &edges);
        assert_eq!(positions[0], egui::Pos2::ZERO);
        let r1 = positions[1].to_vec2().length();
        let r2 = positions[2].to_vec2().length();
        let r3 = positions[3].to_vec2().length();
        assert!((r1 - r2).abs() < 0.01);
        assert!(r3 > r1);
    }

    #[test]
    fn hit_testing_picks_nearest_within_radius() {
        let positions = [egui::pos2(0.0, 0.0), egui::pos2(10.0, 0.0)];
        assert_eq!(hit_test(&positions, egui::pos2(7.0, 0.0), 5.0), Some(1));
        assert_eq!(hit_test(&positions, egui::pos2(-3.0, 0.0), 5.0), Some(0));
        assert_eq!(hit_test(&positions, egui::pos2(50.0, 50.0), 5.0), None);
        assert_eq!(hit_test(&[], egui::pos2(0.0, 0.0), 5.0), None);
    }

    #[test]
    fn node_activation_maps_to_actions() {
        assert_eq!(
            node_action("a/b.md", GraphNodeKind::File),
            Some(WorkspaceAction::OpenNote("a/b.md".to_owned()))
        );
        assert_eq!(
            node_action("?New", GraphNodeKind::Unresolved),
            Some(WorkspaceAction::CreateNoteAt("New.md".to_owned()))
        );
        assert_eq!(node_action("x.png", GraphNodeKind::Attachment), None);
    }

    #[test]
    fn view_refreshes_only_when_inputs_change() {
        let mut view = GraphView::new();
        view.set_graph(sample());
        assert!(view.refresh());
        assert!(!view.refresh());
        assert_eq!(view.visible().nodes.len(), view.positions().len());
        view.filter.show_unresolved = false;
        assert!(view.refresh());
        assert_eq!(view.visible().nodes.len(), 5);
        view.layout = GraphLayoutKind::Radial;
        assert!(view.refresh());
    }

    #[test]
    fn groups_use_top_level_folder() {
        assert_eq!(node_group("Projects/x/y.md"), "Projects");
        assert_eq!(node_group("Home.md"), "");
        assert_eq!(node_folder("Projects/x/y.md"), "Projects/x");
        assert_eq!(group_color("A/x.md"), group_color("A/y/z.md"));
    }
}
