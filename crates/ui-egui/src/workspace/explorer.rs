//! File explorer: a folder tree built from flat vault paths, plus its egui rendering.

use super::fuzzy::compare_names;
use super::{NavKey, WorkspaceAction};
use eframe::egui;
use std::collections::{BTreeMap, BTreeSet};

const INDENT_PER_LEVEL: f32 = 14.0;

/// Whether an explorer row is a folder or a file.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExplorerNodeKind {
    Folder,
    File,
}

/// One visible line of the explorer, in display order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExplorerRow {
    /// Full vault-relative slash path of the folder or file.
    pub path: String,
    /// Last path segment, shown to the user.
    pub name: String,
    /// Nesting depth; top-level entries are `0`.
    pub depth: usize,
    pub kind: ExplorerNodeKind,
    /// For folders: whether children are currently shown. Always `false` for files.
    pub expanded: bool,
}

/// What a keyboard or pointer interaction with the explorer asks for.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExplorerOutcome {
    /// Open this file.
    Open(String),
}

#[derive(Clone, Debug, Default)]
struct FolderNode {
    folders: BTreeMap<String, FolderNode>,
    files: BTreeSet<String>,
}

/// Folder tree state: structure, expanded folders, filter text and selection.
///
/// Folders are listed before files at every level, each group sorted case-insensitively.
/// While a filter is active every folder containing a match is shown expanded, without changing
/// the remembered expansion state.
#[derive(Clone, Debug, Default)]
pub struct ExplorerTree {
    root: FolderNode,
    file_count: usize,
    expanded: BTreeSet<String>,
    filter: String,
    selected: Option<String>,
}

impl ExplorerTree {
    /// Builds a tree from vault paths. Empty segments and leading slashes are ignored.
    pub fn from_paths<I, S>(paths: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut tree = Self::default();
        tree.set_paths(paths);
        tree
    }

    /// Replaces the file list while keeping expansion, filter and (if still present) selection.
    pub fn set_paths<I, S>(&mut self, paths: I)
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut root = FolderNode::default();
        let mut file_count = 0;
        for path in paths {
            let segments: Vec<&str> = path
                .as_ref()
                .split('/')
                .filter(|segment| !segment.is_empty())
                .collect();
            let Some((file, folders)) = segments.split_last() else {
                continue;
            };
            let mut node = &mut root;
            for folder in folders {
                node = node.folders.entry((*folder).to_owned()).or_default();
            }
            if node.files.insert((*file).to_owned()) {
                file_count += 1;
            }
        }
        self.root = root;
        self.file_count = file_count;
        let selection_vanished = self
            .selected
            .as_deref()
            .is_some_and(|selected| !self.contains(selected));
        if selection_vanished {
            self.selected = None;
        }
    }

    /// Number of distinct files in the tree.
    pub fn file_count(&self) -> usize {
        self.file_count
    }

    /// Whether `path` names a file or folder in the tree.
    pub fn contains(&self, path: &str) -> bool {
        self.is_folder(path) || self.is_file(path)
    }

    /// Whether `path` names a folder in the tree.
    pub fn is_folder(&self, path: &str) -> bool {
        self.folder(path).is_some()
    }

    /// Whether `path` names a file in the tree.
    pub fn is_file(&self, path: &str) -> bool {
        let (parent, name) = split_parent(path);
        self.folder(parent)
            .is_some_and(|folder| folder.files.contains(name))
    }

    fn folder(&self, path: &str) -> Option<&FolderNode> {
        let mut node = &self.root;
        for segment in path.split('/').filter(|segment| !segment.is_empty()) {
            node = node.folders.get(segment)?;
        }
        Some(node)
    }

    pub fn is_expanded(&self, folder: &str) -> bool {
        self.expanded.contains(folder)
    }

    pub fn expand(&mut self, folder: &str) {
        if self.is_folder(folder) && !folder.is_empty() {
            self.expanded.insert(folder.to_owned());
        }
    }

    pub fn collapse(&mut self, folder: &str) {
        self.expanded.remove(folder);
    }

    pub fn toggle(&mut self, folder: &str) {
        if self.is_expanded(folder) {
            self.collapse(folder);
        } else {
            self.expand(folder);
        }
    }

    pub fn collapse_all(&mut self) {
        self.expanded.clear();
    }

    pub fn expand_all(&mut self) {
        let mut folders = Vec::new();
        collect_folder_paths(&self.root, "", &mut folders);
        self.expanded.extend(folders);
    }

    /// Expands every ancestor folder of `path` and selects it.
    pub fn reveal(&mut self, path: &str) {
        let mut prefix = String::new();
        let (parent, _) = split_parent(path);
        for segment in parent.split('/').filter(|segment| !segment.is_empty()) {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(segment);
            self.expanded.insert(prefix.clone());
        }
        if self.contains(path) {
            self.selected = Some(path.to_owned());
        }
    }

    pub fn filter(&self) -> &str {
        &self.filter
    }

    pub fn set_filter(&mut self, filter: impl Into<String>) {
        self.filter = filter.into();
    }

    pub fn selected(&self) -> Option<&str> {
        self.selected.as_deref()
    }

    /// Selects `path` when it exists; `None` clears the selection.
    pub fn select(&mut self, path: Option<&str>) {
        self.selected = path.filter(|path| self.contains(path)).map(str::to_owned);
    }

    /// The folder a new note should be created in: the selected folder, the selected file's
    /// folder, or the vault root (`""`).
    pub fn target_folder(&self) -> String {
        match self.selected.as_deref() {
            Some(path) if self.is_folder(path) => path.to_owned(),
            Some(path) => split_parent(path).0.to_owned(),
            None => String::new(),
        }
    }

    /// The rows to display, honoring expansion and the filter.
    pub fn visible_rows(&self) -> Vec<ExplorerRow> {
        let filter = self.filter.trim().to_lowercase();
        let filter = (!filter.is_empty()).then_some(filter.as_str());
        let mut rows = Vec::new();
        self.collect_rows(&self.root, "", 0, filter, &mut rows);
        rows
    }

    fn collect_rows(
        &self,
        node: &FolderNode,
        prefix: &str,
        depth: usize,
        filter: Option<&str>,
        rows: &mut Vec<ExplorerRow>,
    ) {
        let mut folder_names: Vec<&String> = node.folders.keys().collect();
        folder_names.sort_by(|left, right| compare_names(left, right));
        for name in folder_names {
            let Some(child) = node.folders.get(name) else {
                continue;
            };
            let path = join_path(prefix, name);
            if filter.is_some() {
                let mut nested = Vec::new();
                self.collect_rows(child, &path, depth + 1, filter, &mut nested);
                if !nested.is_empty() {
                    rows.push(folder_row(path, name, depth, true));
                    rows.append(&mut nested);
                }
            } else {
                let expanded = self.expanded.contains(&path);
                rows.push(folder_row(path.clone(), name, depth, expanded));
                if expanded {
                    self.collect_rows(child, &path, depth + 1, filter, rows);
                }
            }
        }
        let mut file_names: Vec<&String> = node.files.iter().collect();
        file_names.sort_by(|left, right| compare_names(left, right));
        for name in file_names {
            let path = join_path(prefix, name);
            if filter.is_none_or(|filter| path.to_lowercase().contains(filter)) {
                rows.push(ExplorerRow {
                    path,
                    name: name.clone(),
                    depth,
                    kind: ExplorerNodeKind::File,
                    expanded: false,
                });
            }
        }
    }

    /// Keyboard navigation over the visible rows.
    ///
    /// Up and Down move the selection, Home and End jump to the ends, Right expands a folder (or
    /// moves into an expanded one), Left collapses a folder (or moves to the parent folder), and
    /// Enter opens a file or toggles a folder.
    pub fn handle_key(&mut self, key: NavKey) -> Option<ExplorerOutcome> {
        let rows = self.visible_rows();
        if rows.is_empty() {
            return None;
        }
        let current = self
            .selected
            .as_deref()
            .and_then(|selected| rows.iter().position(|row| row.path == selected));
        let last = rows.len() - 1;
        match key {
            NavKey::Down => {
                let next = current.map_or(0, |index| (index + 1).min(last));
                self.selected = Some(rows[next].path.clone());
            }
            NavKey::Up => {
                let next = current.map_or(last, |index| index.saturating_sub(1));
                self.selected = Some(rows[next].path.clone());
            }
            NavKey::Home => self.selected = Some(rows[0].path.clone()),
            NavKey::End => self.selected = Some(rows[last].path.clone()),
            NavKey::Right => {
                let row = &rows[current?];
                if row.kind == ExplorerNodeKind::Folder {
                    if row.expanded {
                        let child = rows.get(current? + 1).filter(|next| next.depth > row.depth);
                        if let Some(child) = child {
                            self.selected = Some(child.path.clone());
                        }
                    } else {
                        self.expand(&row.path);
                    }
                }
            }
            NavKey::Left => {
                let row = &rows[current?];
                if row.kind == ExplorerNodeKind::Folder && row.expanded && self.filter.is_empty() {
                    self.collapse(&row.path);
                } else {
                    let (parent, _) = split_parent(&row.path);
                    if !parent.is_empty() {
                        self.selected = Some(parent.to_owned());
                    }
                }
            }
            NavKey::Enter => {
                let row = &rows[current?];
                return match row.kind {
                    ExplorerNodeKind::File => Some(ExplorerOutcome::Open(row.path.clone())),
                    ExplorerNodeKind::Folder => {
                        self.toggle(&row.path);
                        None
                    }
                };
            }
            NavKey::Escape => {
                if self.filter.is_empty() {
                    self.selected = None;
                } else {
                    self.filter.clear();
                }
            }
        }
        None
    }
}

fn folder_row(path: String, name: &str, depth: usize, expanded: bool) -> ExplorerRow {
    ExplorerRow {
        path,
        name: name.to_owned(),
        depth,
        kind: ExplorerNodeKind::Folder,
        expanded,
    }
}

fn collect_folder_paths(node: &FolderNode, prefix: &str, out: &mut Vec<String>) {
    for (name, child) in &node.folders {
        let path = join_path(prefix, name);
        collect_folder_paths(child, &path, out);
        out.push(path);
    }
}

fn join_path(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_owned()
    } else {
        format!("{prefix}/{name}")
    }
}

/// Splits `a/b/c.md` into (`a/b`, `c.md`); a top-level name has the parent `""`.
pub(crate) fn split_parent(path: &str) -> (&str, &str) {
    let path = path.trim_matches('/');
    path.rsplit_once('/').unwrap_or(("", path))
}

/// Accessible label of an explorer row; stable so tests and screen readers can target it.
pub fn explorer_row_label(row: &ExplorerRow) -> String {
    match row.kind {
        ExplorerNodeKind::File => format!("Open file {}", row.path),
        ExplorerNodeKind::Folder => format!("Toggle folder {}", row.path),
    }
}

/// Renders the explorer: a toolbar, a filter field and the visible rows.
///
/// Rows are focusable buttons; egui's own arrow-key focus navigation moves between them and
/// Enter or Space activates them. Left and Right collapse and expand the focused folder.
pub fn show_explorer(ui: &mut egui::Ui, tree: &mut ExplorerTree) -> Vec<WorkspaceAction> {
    let mut actions = Vec::new();
    ui.horizontal(|ui| {
        if ui
            .small_button("New note")
            .on_hover_text("Create a note in the selected folder")
            .clicked()
        {
            actions.push(WorkspaceAction::CreateNote {
                folder: tree.target_folder(),
            });
        }
        if ui.small_button("Collapse all folders").clicked() {
            tree.collapse_all();
        }
    });
    ui.horizontal(|ui| {
        let filter_label = ui.label("Filter files");
        let mut filter = tree.filter().to_owned();
        let response = ui.add(
            egui::TextEdit::singleline(&mut filter)
                .id_salt("workspace-explorer-filter")
                .hint_text("Type to filter")
                .desired_width(f32::INFINITY),
        );
        let response = response.labelled_by(filter_label.id);
        if response.changed() {
            tree.set_filter(filter);
        }
    });
    ui.separator();
    if tree.file_count() == 0 {
        ui.weak("No files in this vault yet.");
        return actions;
    }
    let rows = tree.visible_rows();
    if rows.is_empty() {
        ui.weak("No files match the filter.");
        return actions;
    }
    egui::ScrollArea::vertical()
        .id_salt("workspace-explorer-rows")
        .auto_shrink([false, false])
        .show(ui, |ui| {
            for row in &rows {
                ui.push_id(("workspace-explorer-row", &row.path), |ui| {
                    show_explorer_row(ui, tree, row, &mut actions);
                });
            }
        });
    actions
}

fn show_explorer_row(
    ui: &mut egui::Ui,
    tree: &mut ExplorerTree,
    row: &ExplorerRow,
    actions: &mut Vec<WorkspaceAction>,
) {
    ui.horizontal(|ui| {
        ui.add_space(INDENT_PER_LEVEL * depth_as_f32(row.depth));
        let selected = tree.selected() == Some(row.path.as_str());
        let text = match row.kind {
            ExplorerNodeKind::Folder if row.expanded => format!("▼ {}", row.name),
            ExplorerNodeKind::Folder => format!("▶ {}", row.name),
            ExplorerNodeKind::File => row.name.clone(),
        };
        let response = ui.selectable_label(selected, text);
        let label = explorer_row_label(row);
        let is_folder = row.kind == ExplorerNodeKind::Folder;
        let expanded = row.expanded;
        ui.ctx().accesskit_node_builder(response.id, |node| {
            node.set_label(label);
            if is_folder {
                node.set_expanded(expanded);
            }
        });
        if response.gained_focus() {
            tree.select(Some(&row.path));
        }
        if response.has_focus() && is_folder {
            let (left, right) = ui.input(|input| {
                (
                    input.key_pressed(egui::Key::ArrowLeft),
                    input.key_pressed(egui::Key::ArrowRight),
                )
            });
            if left {
                tree.collapse(&row.path);
            } else if right {
                tree.expand(&row.path);
            }
        }
        if response.clicked() {
            tree.select(Some(&row.path));
            match row.kind {
                ExplorerNodeKind::Folder => tree.toggle(&row.path),
                ExplorerNodeKind::File => actions.push(WorkspaceAction::OpenNote(row.path.clone())),
            }
        }
    });
}

fn depth_as_f32(depth: usize) -> f32 {
    f32::from(u16::try_from(depth).unwrap_or(u16::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> ExplorerTree {
        ExplorerTree::from_paths([
            "zeta.md",
            "Alpha.md",
            "notes/b.md",
            "notes/A.md",
            "notes/deep/c.md",
            "/Projects//x.md",
            "",
            "notes/b.md",
        ])
    }

    fn row_paths(tree: &ExplorerTree) -> Vec<String> {
        tree.visible_rows()
            .into_iter()
            .map(|row| row.path)
            .collect()
    }

    #[test]
    fn builds_sorted_folders_first_tree_and_ignores_bad_segments() {
        let tree = sample();
        assert_eq!(tree.file_count(), 6);
        assert_eq!(
            row_paths(&tree),
            ["notes", "Projects", "Alpha.md", "zeta.md"]
        );
        assert!(tree.is_folder("notes/deep"));
        assert!(tree.is_file("Projects/x.md"));
        assert!(!tree.is_file("notes"));
        assert!(!tree.contains("missing.md"));
    }

    #[test]
    fn expand_collapse_and_toggle_change_visible_rows() {
        let mut tree = sample();
        tree.expand("notes");
        assert_eq!(
            row_paths(&tree),
            [
                "notes",
                "notes/deep",
                "notes/A.md",
                "notes/b.md",
                "Projects",
                "Alpha.md",
                "zeta.md"
            ]
        );
        let rows = tree.visible_rows();
        assert_eq!(rows[1].depth, 1);
        assert!(rows[0].expanded);
        tree.toggle("notes");
        assert_eq!(row_paths(&tree).len(), 4);
        tree.expand("not-a-folder");
        assert!(!tree.is_expanded("not-a-folder"));
        tree.expand_all();
        assert!(tree.is_expanded("notes/deep"));
        assert_eq!(tree.visible_rows().len(), 9);
        tree.collapse_all();
        assert_eq!(tree.visible_rows().len(), 4);
    }

    #[test]
    fn filter_shows_matches_with_expanded_ancestors_only() {
        let mut tree = sample();
        tree.set_filter("C.MD");
        assert_eq!(row_paths(&tree), ["notes", "notes/deep", "notes/deep/c.md"]);
        assert!(tree.visible_rows()[0].expanded);
        assert!(!tree.is_expanded("notes"));
        tree.set_filter("nothing-matches");
        assert!(tree.visible_rows().is_empty());
        tree.set_filter("  ");
        assert_eq!(row_paths(&tree).len(), 4);
    }

    #[test]
    fn reveal_expands_ancestors_and_selects() {
        let mut tree = sample();
        tree.reveal("notes/deep/c.md");
        assert!(tree.is_expanded("notes"));
        assert!(tree.is_expanded("notes/deep"));
        assert_eq!(tree.selected(), Some("notes/deep/c.md"));
        assert_eq!(tree.target_folder(), "notes/deep");
        tree.select(Some("notes"));
        assert_eq!(tree.target_folder(), "notes");
        tree.select(Some("missing.md"));
        assert_eq!(tree.selected(), None);
        assert_eq!(tree.target_folder(), "");
    }

    #[test]
    fn set_paths_keeps_state_and_drops_vanished_selection() {
        let mut tree = sample();
        tree.expand("notes");
        tree.select(Some("Alpha.md"));
        tree.set_paths(["notes/new.md", "Alpha.md"]);
        assert!(tree.is_expanded("notes"));
        assert_eq!(tree.selected(), Some("Alpha.md"));
        tree.set_paths(["notes/new.md"]);
        assert_eq!(tree.selected(), None);
        assert_eq!(row_paths(&tree), ["notes", "notes/new.md"]);
    }

    #[test]
    fn keyboard_navigation_moves_expands_collapses_and_opens() {
        let mut tree = sample();
        assert_eq!(tree.handle_key(NavKey::Down), None);
        assert_eq!(tree.selected(), Some("notes"));
        tree.handle_key(NavKey::Right);
        assert!(tree.is_expanded("notes"));
        tree.handle_key(NavKey::Right);
        assert_eq!(tree.selected(), Some("notes/deep"));
        tree.handle_key(NavKey::Down);
        assert_eq!(tree.selected(), Some("notes/A.md"));
        assert_eq!(
            tree.handle_key(NavKey::Enter),
            Some(ExplorerOutcome::Open("notes/A.md".to_owned()))
        );
        tree.handle_key(NavKey::Left);
        assert_eq!(tree.selected(), Some("notes"));
        tree.handle_key(NavKey::Left);
        assert!(!tree.is_expanded("notes"));
        tree.handle_key(NavKey::End);
        assert_eq!(tree.selected(), Some("zeta.md"));
        tree.handle_key(NavKey::Down);
        assert_eq!(tree.selected(), Some("zeta.md"));
        tree.handle_key(NavKey::Home);
        assert_eq!(tree.selected(), Some("notes"));
        tree.handle_key(NavKey::Up);
        assert_eq!(tree.selected(), Some("notes"));
        assert_eq!(tree.handle_key(NavKey::Enter), None);
        assert!(tree.is_expanded("notes"));
        tree.handle_key(NavKey::Escape);
        assert_eq!(tree.selected(), None);
    }

    #[test]
    fn split_parent_handles_top_level_and_nested_paths() {
        assert_eq!(split_parent("a/b/c.md"), ("a/b", "c.md"));
        assert_eq!(split_parent("c.md"), ("", "c.md"));
        assert_eq!(split_parent("/a/"), ("", "a"));
    }
}
