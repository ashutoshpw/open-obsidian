//! Right-hand side pane: backlinks, outgoing links, tags and vault search.

use super::WorkspaceAction;
use super::backend::{BacklinkRow, BookmarkRow, HeadingRow, LinkRow, SearchRow, WorkspaceBackend};
use super::tabs::set_accessible_label;
use eframe::egui;

/// Maximum number of search rows requested from the backend.
pub const SEARCH_LIMIT: usize = 100;

/// Which view the side pane shows.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub enum SidePaneTab {
    #[default]
    Backlinks,
    Outgoing,
    Tags,
    Search,
    Outline,
    Bookmarks,
}

impl SidePaneTab {
    pub const ALL: [Self; 6] = [
        Self::Backlinks,
        Self::Outgoing,
        Self::Outline,
        Self::Tags,
        Self::Bookmarks,
        Self::Search,
    ];

    pub fn title(self) -> &'static str {
        match self {
            Self::Backlinks => "Backlinks",
            Self::Outgoing => "Outgoing links",
            Self::Tags => "Tags",
            Self::Search => "Search",
            Self::Outline => "Outline",
            Self::Bookmarks => "Bookmarks",
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct CacheKey {
    tab: SidePaneTab,
    active: Option<String>,
    query: String,
    tag: Option<String>,
    revision: u64,
}

/// Side pane state with backend answers cached per tab, note, query, tag and revision.
#[derive(Clone, Debug, Default)]
pub struct SidePane {
    pub tab: SidePaneTab,
    search_query: String,
    selected_tag: Option<String>,
    search_focus_pending: bool,
    cache_key: Option<CacheKey>,
    backlinks: Vec<BacklinkRow>,
    outgoing: Vec<LinkRow>,
    tags: Vec<(String, usize)>,
    tag_notes: Vec<String>,
    search_results: Vec<SearchRow>,
    headings: Vec<HeadingRow>,
    bookmarks: Vec<BookmarkRow>,
}

impl SidePane {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn search_query(&self) -> &str {
        &self.search_query
    }

    pub fn set_search_query(&mut self, query: impl Into<String>) {
        self.search_query = query.into();
    }

    /// Switches to the search tab and focuses its query field on the next frame.
    pub fn focus_search(&mut self) {
        self.tab = SidePaneTab::Search;
        self.search_focus_pending = true;
    }

    pub fn selected_tag(&self) -> Option<&str> {
        self.selected_tag.as_deref()
    }

    pub fn select_tag(&mut self, tag: Option<&str>) {
        self.selected_tag = tag.map(str::to_owned);
    }

    pub fn backlinks(&self) -> &[BacklinkRow] {
        &self.backlinks
    }

    pub fn outgoing(&self) -> &[LinkRow] {
        &self.outgoing
    }

    pub fn tags(&self) -> &[(String, usize)] {
        &self.tags
    }

    pub fn tag_notes(&self) -> &[String] {
        &self.tag_notes
    }

    pub fn search_results(&self) -> &[SearchRow] {
        &self.search_results
    }

    pub fn headings(&self) -> &[HeadingRow] {
        &self.headings
    }

    pub fn bookmarks(&self) -> &[BookmarkRow] {
        &self.bookmarks
    }

    /// Queries the backend for the current tab when anything relevant changed.
    pub fn refresh(&mut self, active_note: Option<&str>, backend: &dyn WorkspaceBackend) {
        let key = CacheKey {
            tab: self.tab,
            active: active_note.map(str::to_owned),
            query: self.search_query.trim().to_owned(),
            tag: self.selected_tag.clone(),
            revision: backend.revision(),
        };
        if self.cache_key.as_ref() == Some(&key) {
            return;
        }
        self.backlinks.clear();
        self.outgoing.clear();
        self.tags.clear();
        self.tag_notes.clear();
        self.search_results.clear();
        self.headings.clear();
        self.bookmarks.clear();
        match key.tab {
            SidePaneTab::Backlinks => {
                if let Some(active) = &key.active {
                    self.backlinks = backend.backlinks(active);
                }
            }
            SidePaneTab::Outgoing => {
                if let Some(active) = &key.active {
                    self.outgoing = backend.outgoing_links(active);
                }
            }
            SidePaneTab::Tags => {
                self.tags = backend.tags();
                if let Some(tag) = &key.tag {
                    self.tag_notes = backend.notes_with_tag(tag);
                }
            }
            SidePaneTab::Outline => {
                if let Some(active) = &key.active {
                    self.headings = backend.headings(active);
                }
            }
            SidePaneTab::Bookmarks => self.bookmarks = backend.bookmarks(),
            SidePaneTab::Search => {
                if !key.query.is_empty() {
                    self.search_results = backend.search(&key.query, SEARCH_LIMIT);
                }
            }
        }
        self.cache_key = Some(key);
    }
}

/// The path a "create" button should use for an unresolved link label.
pub fn note_path_for_link(target_label: &str) -> String {
    let target = target_label.trim().trim_matches('/');
    let name = target.rsplit('/').next().unwrap_or(target);
    if name.contains('.') {
        target.to_owned()
    } else {
        format!("{target}.md")
    }
}

/// Renders the side pane for `active_note` and returns what the user asked for.
pub fn show_side_pane(
    ui: &mut egui::Ui,
    pane: &mut SidePane,
    active_note: Option<&str>,
    backend: &dyn WorkspaceBackend,
) -> Vec<WorkspaceAction> {
    let mut actions = Vec::new();
    ui.horizontal_wrapped(|ui| {
        for tab in SidePaneTab::ALL {
            let response = ui.selectable_value(&mut pane.tab, tab, tab.title());
            set_accessible_label(ui, &response, &format!("{} pane", tab.title()));
        }
    });
    ui.separator();
    if pane.tab == SidePaneTab::Search {
        show_search_field(ui, pane);
    }
    pane.refresh(active_note, backend);
    egui::ScrollArea::vertical()
        .id_salt("workspace-side-pane")
        .auto_shrink([false, false])
        .show(ui, |ui| match pane.tab {
            SidePaneTab::Backlinks => show_backlinks(ui, pane, active_note, &mut actions),
            SidePaneTab::Outgoing => show_outgoing(ui, pane, active_note, &mut actions),
            SidePaneTab::Tags => show_tags(ui, pane, &mut actions),
            SidePaneTab::Search => show_search_results(ui, pane, &mut actions),
            SidePaneTab::Outline => show_outline(ui, pane, active_note),
            SidePaneTab::Bookmarks => show_bookmarks(ui, pane, &mut actions),
        });
    actions
}

fn show_search_field(ui: &mut egui::Ui, pane: &mut SidePane) {
    let label = ui.label("Search vault");
    let mut query = pane.search_query.clone();
    let response = ui
        .add(
            egui::TextEdit::singleline(&mut query)
                .id_salt("workspace-side-pane-search")
                .hint_text("Search text…")
                .desired_width(f32::INFINITY),
        )
        .labelled_by(label.id);
    if pane.search_focus_pending {
        if response.has_focus() {
            pane.search_focus_pending = false;
        } else {
            response.request_focus();
        }
    }
    if response.changed() {
        pane.search_query = query;
    }
}

fn show_backlinks(
    ui: &mut egui::Ui,
    pane: &SidePane,
    active_note: Option<&str>,
    actions: &mut Vec<WorkspaceAction>,
) {
    let Some(active) = active_note else {
        ui.weak("Open a note to see its backlinks.");
        return;
    };
    ui.label(format!("Linked mentions of {active}"));
    if pane.backlinks().is_empty() {
        ui.weak("No backlinks found.");
    }
    for row in pane.backlinks() {
        let text = format!("{} (line {})", row.source, row.line);
        let response = ui.button(text);
        let label = format!("Backlink from {} line {}", row.source, row.line);
        set_accessible_label(ui, &response, &label);
        if response.clicked() {
            actions.push(WorkspaceAction::OpenNote(row.source.clone()));
        }
    }
}

fn show_outgoing(
    ui: &mut egui::Ui,
    pane: &SidePane,
    active_note: Option<&str>,
    actions: &mut Vec<WorkspaceAction>,
) {
    let Some(active) = active_note else {
        ui.weak("Open a note to see its outgoing links.");
        return;
    };
    ui.label(format!("Links in {active}"));
    if pane.outgoing().is_empty() {
        ui.weak("No outgoing links found.");
    }
    for row in pane.outgoing() {
        match &row.resolved {
            Some(path) => {
                let response = ui.button(row.target_label.as_str());
                let label = format!("Open link {}", row.target_label);
                set_accessible_label(ui, &response, &label);
                if response.clicked() {
                    actions.push(WorkspaceAction::OpenNote(path.clone()));
                }
            }
            None => {
                ui.horizontal(|ui| {
                    ui.weak(format!("{} (unresolved)", row.target_label));
                    let response = ui.small_button("Create");
                    let label = format!("Create note {}", row.target_label);
                    set_accessible_label(ui, &response, &label);
                    if response.clicked() {
                        let path = note_path_for_link(&row.target_label);
                        actions.push(WorkspaceAction::CreateNoteAt(path));
                    }
                });
            }
        }
    }
}

fn show_outline(ui: &mut egui::Ui, pane: &SidePane, active_note: Option<&str>) {
    if active_note.is_none() {
        ui.weak("Open a note to see its outline.");
        return;
    }
    if pane.headings().is_empty() {
        ui.weak("No headings found.");
    }
    for heading in pane.headings() {
        ui.horizontal(|ui| {
            ui.add_space(f32::from(heading.level.saturating_sub(1)) * 12.0);
            let response = ui.label(format!("{} (line {})", heading.text, heading.line));
            set_accessible_label(
                ui,
                &response,
                &format!("Heading level {} {}", heading.level, heading.text),
            );
        });
    }
}

fn show_bookmarks(ui: &mut egui::Ui, pane: &SidePane, actions: &mut Vec<WorkspaceAction>) {
    if pane.bookmarks().is_empty() {
        ui.weak("No bookmarks found.");
    }
    for row in pane.bookmarks() {
        match &row.path {
            Some(path) => {
                let response = ui.button(row.title.as_str());
                set_accessible_label(ui, &response, &format!("Open bookmark {}", row.title));
                if response.clicked() {
                    actions.push(WorkspaceAction::OpenNote(path.clone()));
                }
            }
            None => {
                ui.weak(row.title.as_str());
            }
        }
    }
}

fn show_tags(ui: &mut egui::Ui, pane: &mut SidePane, actions: &mut Vec<WorkspaceAction>) {
    if pane.tags().is_empty() {
        ui.weak("No tags found.");
        return;
    }
    let mut toggled = None;
    for (tag, count) in pane.tags() {
        let selected = pane.selected_tag() == Some(tag.as_str());
        let response = ui.selectable_label(selected, format!("#{tag} ({count})"));
        set_accessible_label(ui, &response, &format!("Tag {tag}"));
        if response.clicked() {
            toggled = Some(if selected { None } else { Some(tag.clone()) });
        }
    }
    if let Some(selected_tag) = &pane.selected_tag {
        ui.separator();
        ui.label(format!("Notes tagged #{selected_tag}"));
        for path in pane.tag_notes() {
            let response = ui.button(path.as_str());
            set_accessible_label(ui, &response, &format!("Open tagged note {path}"));
            if response.clicked() {
                actions.push(WorkspaceAction::OpenNote(path.clone()));
            }
        }
    }
    if let Some(selection) = toggled {
        pane.select_tag(selection.as_deref());
        ui.ctx().request_repaint();
    }
}

fn show_search_results(ui: &mut egui::Ui, pane: &SidePane, actions: &mut Vec<WorkspaceAction>) {
    if pane.search_query().trim().is_empty() {
        ui.weak("Type to search every note.");
        return;
    }
    if pane.search_results().is_empty() {
        ui.weak("No results.");
    }
    for row in pane.search_results() {
        let response = ui.button(row.path.as_str());
        set_accessible_label(ui, &response, &format!("Open search result {}", row.path));
        if response.clicked() {
            actions.push(WorkspaceAction::OpenNote(row.path.clone()));
        }
        if !row.preview.is_empty() {
            ui.weak(row.preview.as_str());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::backend::InMemoryBackend;

    fn backend() -> InMemoryBackend {
        InMemoryBackend::new()
            .with_note("a.md", "Links to [[b]] and [[Nowhere]] #topic")
            .with_note("b.md", "Back to [[a]]\nsecond line [[a]] #topic #other")
    }

    #[test]
    fn refresh_loads_only_the_active_tab_and_caches_by_key() {
        let mut backend = backend();
        let mut pane = SidePane::new();
        pane.refresh(Some("a.md"), &backend);
        assert_eq!(pane.backlinks().len(), 2);
        assert!(pane.outgoing().is_empty());

        pane.tab = SidePaneTab::Outgoing;
        pane.refresh(Some("a.md"), &backend);
        assert!(pane.backlinks().is_empty());
        assert_eq!(pane.outgoing().len(), 2);
        assert_eq!(pane.outgoing()[1].resolved, None);

        backend.insert_note("c.md", "[[a]]");
        pane.tab = SidePaneTab::Backlinks;
        pane.refresh(Some("a.md"), &backend);
        assert_eq!(pane.backlinks().len(), 3);

        pane.refresh(None, &backend);
        assert!(pane.backlinks().is_empty());
    }

    #[test]
    fn tags_and_search_follow_selection_and_query() {
        let backend = backend();
        let mut pane = SidePane::new();
        pane.tab = SidePaneTab::Tags;
        pane.refresh(None, &backend);
        assert_eq!(
            pane.tags(),
            [("other".to_owned(), 1), ("topic".to_owned(), 2)]
        );
        assert!(pane.tag_notes().is_empty());
        pane.select_tag(Some("topic"));
        pane.refresh(None, &backend);
        assert_eq!(pane.tag_notes(), ["a.md", "b.md"]);

        pane.focus_search();
        assert_eq!(pane.tab, SidePaneTab::Search);
        pane.refresh(None, &backend);
        assert!(pane.search_results().is_empty());
        pane.set_search_query("second");
        pane.refresh(None, &backend);
        assert_eq!(pane.search_results().len(), 1);
        assert_eq!(pane.search_results()[0].path, "b.md");
    }

    #[test]
    fn unresolved_link_paths_get_a_markdown_extension() {
        assert_eq!(note_path_for_link("New idea"), "New idea.md");
        assert_eq!(note_path_for_link("folder/New"), "folder/New.md");
        assert_eq!(note_path_for_link("diagram.canvas"), "diagram.canvas");
    }
}
