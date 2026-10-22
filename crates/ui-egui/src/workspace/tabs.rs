//! Editor tabs: open/activate/close/reorder/pin, MRU fallback on close, back/forward history,
//! and a small line-based persistence format.

use super::WorkspaceAction;
use eframe::egui;
use std::fmt;

const MAX_HISTORY: usize = 100;
const PERSISTENCE_HEADER: &str = "openobsidian-tabs 1";

/// One open note.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Tab {
    /// Vault-relative slash path.
    pub path: String,
    /// Pinned tabs are never replaced by navigation and cannot be closed with [`TabSet::close`].
    pub pinned: bool,
}

impl Tab {
    /// The file name without a trailing `.md`, as shown on the tab.
    pub fn title(&self) -> &str {
        tab_title(&self.path)
    }
}

/// The file name of `path` without a trailing `.md`.
pub fn tab_title(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".md").unwrap_or(name)
}

/// Ordered, de-duplicated set of open tabs with navigation history.
///
/// History is global (like a browser window): every user-driven change of the active note
/// pushes the previous note onto the back stack and clears the forward stack. Closing the
/// active tab activates the most recently used remaining tab.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TabSet {
    tabs: Vec<Tab>,
    active: Option<usize>,
    mru: Vec<String>,
    back: Vec<String>,
    forward: Vec<String>,
}

impl TabSet {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn tabs(&self) -> &[Tab] {
        &self.tabs
    }

    pub fn len(&self) -> usize {
        self.tabs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tabs.is_empty()
    }

    pub fn active_index(&self) -> Option<usize> {
        self.active
    }

    pub fn active_path(&self) -> Option<&str> {
        self.active
            .and_then(|index| self.tabs.get(index))
            .map(|tab| tab.path.as_str())
    }

    pub fn position(&self, path: &str) -> Option<usize> {
        self.tabs.iter().position(|tab| tab.path == path)
    }

    /// Opens `path` in a new tab next to the active one, or activates its existing tab.
    pub fn open(&mut self, path: &str) -> usize {
        self.navigate(path, false, true)
    }

    /// Shows `path` in the active tab (Obsidian's default click behavior), or activates its
    /// existing tab. A pinned active tab is never replaced; a new tab is opened instead.
    pub fn open_in_active(&mut self, path: &str) -> usize {
        self.navigate(path, true, true)
    }

    /// Activates the tab at `index`. Returns `false` when there is no such tab.
    pub fn activate(&mut self, index: usize) -> bool {
        let Some(tab) = self.tabs.get(index) else {
            return false;
        };
        let path = tab.path.clone();
        self.navigate(&path, false, true);
        true
    }

    /// Activates the tab to the right of the active one, wrapping around.
    pub fn activate_next(&mut self) -> bool {
        let len = self.tabs.len();
        if len == 0 {
            return false;
        }
        let next = self.active.map_or(0, |active| (active + 1) % len);
        self.activate(next)
    }

    /// Activates the tab to the left of the active one, wrapping around.
    pub fn activate_previous(&mut self) -> bool {
        let len = self.tabs.len();
        if len == 0 {
            return false;
        }
        let previous = self
            .active
            .map_or(len - 1, |active| (active + len - 1) % len);
        self.activate(previous)
    }

    /// Closes the tab at `index` unless it is pinned.
    pub fn close(&mut self, index: usize) -> Option<Tab> {
        if self.tabs.get(index)?.pinned {
            return None;
        }
        Some(self.remove_tab(index))
    }

    /// Closes the active tab unless it is pinned.
    pub fn close_active(&mut self) -> Option<Tab> {
        let index = self.active?;
        self.close(index)
    }

    /// Closes every unpinned tab except the one at `keep`, which becomes active.
    pub fn close_others(&mut self, keep: usize) -> Vec<Tab> {
        let Some(kept_path) = self.tabs.get(keep).map(|tab| tab.path.clone()) else {
            return Vec::new();
        };
        let mut closed = Vec::new();
        for index in (0..self.tabs.len()).rev() {
            if index != keep && !self.tabs[index].pinned {
                closed.push(self.remove_tab(index));
            }
        }
        closed.reverse();
        self.navigate(&kept_path, false, true);
        closed
    }

    /// Moves the tab at `from` to position `to`, keeping the same tab active.
    pub fn move_tab(&mut self, from: usize, to: usize) -> bool {
        if from >= self.tabs.len() || to >= self.tabs.len() {
            return false;
        }
        let active_path = self.active_path().map(str::to_owned);
        let tab = self.tabs.remove(from);
        self.tabs.insert(to, tab);
        self.active = active_path.and_then(|path| self.position(&path));
        true
    }

    pub fn set_pinned(&mut self, index: usize, pinned: bool) -> bool {
        let Some(tab) = self.tabs.get_mut(index) else {
            return false;
        };
        tab.pinned = pinned;
        true
    }

    pub fn toggle_pinned(&mut self, index: usize) -> bool {
        let Some(pinned) = self.tabs.get(index).map(|tab| tab.pinned) else {
            return false;
        };
        self.set_pinned(index, !pinned)
    }

    pub fn can_go_back(&self) -> bool {
        !self.back.is_empty()
    }

    pub fn can_go_forward(&self) -> bool {
        !self.forward.is_empty()
    }

    /// Navigates to the previous note in history and returns it.
    pub fn go_back(&mut self) -> Option<String> {
        let current = self.active_path().map(str::to_owned);
        let target = pop_until_different(&mut self.back, current.as_deref())?;
        if let Some(current) = current {
            push_bounded(&mut self.forward, current);
        }
        self.navigate(&target, true, false);
        Some(target)
    }

    /// Navigates to the next note in history and returns it.
    pub fn go_forward(&mut self) -> Option<String> {
        let current = self.active_path().map(str::to_owned);
        let target = pop_until_different(&mut self.forward, current.as_deref())?;
        if let Some(current) = current {
            push_bounded(&mut self.back, current);
        }
        self.navigate(&target, true, false);
        Some(target)
    }

    /// Updates tabs and history after a file or folder rename.
    pub fn rename_path(&mut self, old: &str, new: &str) {
        for tab in &mut self.tabs {
            if let Some(renamed) = renamed_path(&tab.path, old, new) {
                tab.path = renamed;
            }
        }
        for stack in [&mut self.mru, &mut self.back, &mut self.forward] {
            for entry in stack.iter_mut() {
                if let Some(renamed) = renamed_path(entry, old, new) {
                    *entry = renamed;
                }
            }
        }
    }

    /// Closes tabs (pinned or not) and forgets history for a deleted file.
    pub fn remove_path(&mut self, path: &str) -> bool {
        let mut removed = false;
        while let Some(index) = self.position(path) {
            self.remove_tab(index);
            removed = true;
        }
        self.back.retain(|entry| entry != path);
        self.forward.retain(|entry| entry != path);
        removed
    }

    /// Serializes tabs, pin flags and the active tab (not history) to a small line format.
    pub fn to_persisted_string(&self) -> String {
        let mut out = String::from(PERSISTENCE_HEADER);
        out.push('\n');
        match self.active {
            Some(index) => out.push_str(&format!("active {index}\n")),
            None => out.push_str("active -\n"),
        }
        for tab in &self.tabs {
            let flag = if tab.pinned { '1' } else { '0' };
            out.push_str(&format!("tab {flag} {}\n", escape_path(&tab.path)));
        }
        out
    }

    /// Restores a set written by [`Self::to_persisted_string`].
    pub fn from_persisted_string(input: &str) -> Result<Self, TabSetParseError> {
        let mut lines = input.lines().enumerate();
        match lines.next() {
            Some((_, header)) if header.trim_end() == PERSISTENCE_HEADER => {}
            _ => return Err(TabSetParseError::MissingHeader),
        }
        let mut set = Self::default();
        let mut active = None;
        for (index, line) in lines {
            let line_number = index + 1;
            let invalid = TabSetParseError::InvalidLine(line_number);
            if line.trim().is_empty() {
                continue;
            }
            if let Some(value) = line.strip_prefix("active ") {
                active = match value.trim() {
                    "-" => None,
                    number => Some(number.parse::<usize>().map_err(|_| invalid)?),
                };
            } else if let Some(rest) = line.strip_prefix("tab ") {
                let (flag, escaped) = rest.split_once(' ').ok_or(invalid)?;
                let pinned = match flag {
                    "0" => false,
                    "1" => true,
                    _ => return Err(invalid),
                };
                let path = unescape_path(escaped).ok_or(invalid)?;
                if path.is_empty() {
                    return Err(invalid);
                }
                if set.position(&path).is_none() {
                    set.tabs.push(Tab { path, pinned });
                }
            } else {
                return Err(invalid);
            }
        }
        set.active = active.filter(|index| *index < set.tabs.len());
        if let Some(path) = set.active_path().map(str::to_owned) {
            set.mru.push(path);
        }
        Ok(set)
    }

    fn navigate(&mut self, path: &str, replace_active: bool, record: bool) -> usize {
        let previous = self.active_path().map(str::to_owned);
        let index = if let Some(index) = self.position(path) {
            index
        } else if replace_active
            && let Some(active) = self.active
            && self.tabs.get(active).is_some_and(|tab| !tab.pinned)
        {
            let old = std::mem::replace(&mut self.tabs[active].path, path.to_owned());
            self.mru.retain(|entry| *entry != old);
            active
        } else {
            let at = self.active.map_or(self.tabs.len(), |active| active + 1);
            let tab = Tab {
                path: path.to_owned(),
                pinned: false,
            };
            self.tabs.insert(at, tab);
            at
        };
        self.active = Some(index);
        self.mru.retain(|entry| entry != path);
        push_bounded(&mut self.mru, path.to_owned());
        if record
            && let Some(previous) = previous
            && previous != path
        {
            push_bounded(&mut self.back, previous);
            self.forward.clear();
        }
        index
    }

    fn remove_tab(&mut self, index: usize) -> Tab {
        let tab = self.tabs.remove(index);
        self.mru.retain(|entry| *entry != tab.path);
        self.active = match self.active {
            Some(active) if active == index => self.fallback_active(index),
            Some(active) if active > index => Some(active - 1),
            other => other,
        };
        tab
    }

    fn fallback_active(&self, closed_index: usize) -> Option<usize> {
        let recent = self.mru.iter().rev().find_map(|path| self.position(path));
        let last = self.tabs.len().checked_sub(1)?;
        Some(recent.unwrap_or(closed_index.min(last)))
    }
}

/// Why [`TabSet::from_persisted_string`] rejected its input.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TabSetParseError {
    /// The first line is not the expected format header.
    MissingHeader,
    /// The given one-based line could not be parsed.
    InvalidLine(usize),
}

impl fmt::Display for TabSetParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingHeader => formatter.write_str("missing tab set header"),
            Self::InvalidLine(line) => write!(formatter, "invalid tab set line {line}"),
        }
    }
}

impl std::error::Error for TabSetParseError {}

fn push_bounded(stack: &mut Vec<String>, entry: String) {
    stack.push(entry);
    if stack.len() > MAX_HISTORY {
        stack.remove(0);
    }
}

fn pop_until_different(stack: &mut Vec<String>, current: Option<&str>) -> Option<String> {
    while let Some(candidate) = stack.pop() {
        if Some(candidate.as_str()) != current {
            return Some(candidate);
        }
    }
    None
}

fn renamed_path(path: &str, old: &str, new: &str) -> Option<String> {
    if path == old {
        return Some(new.to_owned());
    }
    let rest = path.strip_prefix(old)?.strip_prefix('/')?;
    Some(format!("{new}/{rest}"))
}

fn escape_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for character in path.chars() {
        match character {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            other => out.push(other),
        }
    }
    out
}

fn unescape_path(escaped: &str) -> Option<String> {
    let mut out = String::with_capacity(escaped.len());
    let mut characters = escaped.chars();
    while let Some(character) = characters.next() {
        if character == '\\' {
            match characters.next()? {
                '\\' => out.push('\\'),
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                _ => return None,
            }
        } else {
            out.push(character);
        }
    }
    Some(out)
}

/// Accessible label of a tab button.
pub fn tab_label(path: &str) -> String {
    format!("Tab {path}")
}

/// Accessible label of a tab's close button.
pub fn close_tab_label(path: &str) -> String {
    format!("Close tab {path}")
}

enum TabOperation {
    Activate(usize),
    Close(usize),
    TogglePin(usize),
    Move(usize, usize),
    CloseOthers(usize),
    Back,
    Forward,
}

/// Renders back/forward buttons and the tab strip.
///
/// Returns [`WorkspaceAction::TabClosed`] for every tab the user closed. Activation changes are
/// reported by [`super::Workspace::show`], which compares the active note before and after.
pub fn show_tab_bar(ui: &mut egui::Ui, tabs: &mut TabSet) -> Vec<WorkspaceAction> {
    let mut operation = None;
    ui.horizontal_wrapped(|ui| {
        let back = ui.add_enabled(tabs.can_go_back(), egui::Button::new("◀"));
        set_accessible_label(ui, &back, "Navigate back");
        if back.clicked() {
            operation = Some(TabOperation::Back);
        }
        let forward = ui.add_enabled(tabs.can_go_forward(), egui::Button::new("▶"));
        set_accessible_label(ui, &forward, "Navigate forward");
        if forward.clicked() {
            operation = Some(TabOperation::Forward);
        }
        ui.separator();
        if tabs.is_empty() {
            ui.weak("No open notes");
        }
        let count = tabs.len();
        for (index, tab) in tabs.tabs().iter().enumerate() {
            let active = tabs.active_index() == Some(index);
            ui.push_id(("workspace-tab", &tab.path), |ui| {
                if let Some(chosen) = show_tab(ui, index, count, tab, active) {
                    operation = Some(chosen);
                }
            });
        }
    });
    let mut actions = Vec::new();
    match operation {
        Some(TabOperation::Activate(index)) => {
            tabs.activate(index);
        }
        Some(TabOperation::Close(index)) => {
            if let Some(tab) = tabs.close(index) {
                actions.push(WorkspaceAction::TabClosed(tab.path));
            }
        }
        Some(TabOperation::TogglePin(index)) => {
            tabs.toggle_pinned(index);
        }
        Some(TabOperation::Move(from, to)) => {
            tabs.move_tab(from, to);
        }
        Some(TabOperation::CloseOthers(keep)) => {
            for tab in tabs.close_others(keep) {
                actions.push(WorkspaceAction::TabClosed(tab.path));
            }
        }
        Some(TabOperation::Back) => {
            tabs.go_back();
        }
        Some(TabOperation::Forward) => {
            tabs.go_forward();
        }
        None => {}
    }
    actions
}

fn show_tab(
    ui: &mut egui::Ui,
    index: usize,
    count: usize,
    tab: &Tab,
    active: bool,
) -> Option<TabOperation> {
    let mut operation = None;
    let title = if tab.pinned {
        format!("{} (pinned)", tab.title())
    } else {
        tab.title().to_owned()
    };
    let response = ui
        .selectable_label(active, title)
        .on_hover_text(tab.path.as_str());
    set_accessible_label(ui, &response, &tab_label(&tab.path));
    if response.clicked() {
        operation = Some(TabOperation::Activate(index));
    }
    if response.middle_clicked() && !tab.pinned {
        operation = Some(TabOperation::Close(index));
    }
    response.context_menu(|ui| {
        let pin_text = if tab.pinned { "Unpin tab" } else { "Pin tab" };
        if ui.button(pin_text).clicked() {
            operation = Some(TabOperation::TogglePin(index));
            ui.close();
        }
        if index > 0 && ui.button("Move tab left").clicked() {
            operation = Some(TabOperation::Move(index, index - 1));
            ui.close();
        }
        if index + 1 < count && ui.button("Move tab right").clicked() {
            operation = Some(TabOperation::Move(index, index + 1));
            ui.close();
        }
        if count > 1 && ui.button("Close other tabs").clicked() {
            operation = Some(TabOperation::CloseOthers(index));
            ui.close();
        }
    });
    if !tab.pinned {
        let close = ui.small_button("×");
        set_accessible_label(ui, &close, &close_tab_label(&tab.path));
        if close.clicked() {
            operation = Some(TabOperation::Close(index));
        }
    }
    operation
}

pub(crate) fn set_accessible_label(ui: &egui::Ui, response: &egui::Response, label: &str) {
    ui.ctx().accesskit_node_builder(response.id, |node| {
        node.set_label(label);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(set: &TabSet) -> Vec<&str> {
        set.tabs().iter().map(|tab| tab.path.as_str()).collect()
    }

    #[test]
    fn open_dedupes_and_inserts_after_active() {
        let mut set = TabSet::new();
        assert_eq!(set.open("a.md"), 0);
        assert_eq!(set.open("b.md"), 1);
        set.activate(0);
        assert_eq!(set.open("c.md"), 1);
        assert_eq!(paths(&set), ["a.md", "c.md", "b.md"]);
        assert_eq!(set.open("b.md"), 2);
        assert_eq!(set.len(), 3);
        assert_eq!(set.active_path(), Some("b.md"));
    }

    #[test]
    fn open_in_active_replaces_unpinned_and_respects_pins() {
        let mut set = TabSet::new();
        set.open_in_active("a.md");
        set.open_in_active("b.md");
        assert_eq!(paths(&set), ["b.md"]);
        assert!(set.set_pinned(0, true));
        set.open_in_active("c.md");
        assert_eq!(paths(&set), ["b.md", "c.md"]);
        assert_eq!(set.active_path(), Some("c.md"));
        set.open_in_active("b.md");
        assert_eq!(set.active_index(), Some(0));
    }

    #[test]
    fn close_uses_mru_and_refuses_pinned_tabs() {
        let mut set = TabSet::new();
        set.open("a.md");
        set.open("b.md");
        set.open("c.md");
        set.activate(0);
        set.activate(2);
        assert_eq!(set.close(2).map(|tab| tab.path), Some("c.md".to_owned()));
        assert_eq!(set.active_path(), Some("a.md"));
        set.toggle_pinned(0);
        assert_eq!(set.close(0), None);
        assert_eq!(set.close_active(), None);
        assert_eq!(set.close(1).map(|tab| tab.path), Some("b.md".to_owned()));
        assert_eq!(paths(&set), ["a.md"]);
        assert_eq!(set.active_index(), Some(0));
        assert_eq!(set.close(5), None);
    }

    #[test]
    fn closing_tab_before_active_shifts_active_index() {
        let mut set = TabSet::new();
        set.open("a.md");
        set.open("b.md");
        set.open("c.md");
        set.close(0);
        assert_eq!(set.active_path(), Some("c.md"));
        assert_eq!(set.active_index(), Some(1));
        set.close(1);
        set.close(0);
        assert!(set.is_empty());
        assert_eq!(set.active_index(), None);
        assert_eq!(set.active_path(), None);
    }

    #[test]
    fn reorder_and_cycle_keep_active_tab() {
        let mut set = TabSet::new();
        set.open("a.md");
        set.open("b.md");
        set.open("c.md");
        assert!(set.move_tab(2, 0));
        assert_eq!(paths(&set), ["c.md", "a.md", "b.md"]);
        assert_eq!(set.active_path(), Some("c.md"));
        assert!(!set.move_tab(0, 3));
        set.activate_next();
        assert_eq!(set.active_path(), Some("a.md"));
        set.activate_previous();
        set.activate_previous();
        assert_eq!(set.active_path(), Some("b.md"));
        set.activate_next();
        assert_eq!(set.active_path(), Some("c.md"));
    }

    #[test]
    fn close_others_keeps_pinned_tabs() {
        let mut set = TabSet::new();
        set.open("a.md");
        set.open("b.md");
        set.open("c.md");
        set.open("d.md");
        set.set_pinned(0, true);
        let closed: Vec<String> = set
            .close_others(2)
            .into_iter()
            .map(|tab| tab.path)
            .collect();
        assert_eq!(closed, ["b.md", "d.md"]);
        assert_eq!(paths(&set), ["a.md", "c.md"]);
        assert_eq!(set.active_path(), Some("c.md"));
    }

    #[test]
    fn back_and_forward_walk_history() {
        let mut set = TabSet::new();
        assert!(!set.can_go_back());
        set.open_in_active("a.md");
        set.open_in_active("b.md");
        set.open_in_active("c.md");
        assert_eq!(set.go_back().as_deref(), Some("b.md"));
        assert_eq!(set.go_back().as_deref(), Some("a.md"));
        assert_eq!(set.go_back(), None);
        assert!(set.can_go_forward());
        assert_eq!(set.go_forward().as_deref(), Some("b.md"));
        assert_eq!(paths(&set), ["b.md"]);
        set.open_in_active("d.md");
        assert!(!set.can_go_forward());
        assert_eq!(set.go_back().as_deref(), Some("b.md"));
    }

    #[test]
    fn rename_and_remove_update_tabs_and_history() {
        let mut set = TabSet::new();
        set.open("folder/a.md");
        set.open("b.md");
        set.rename_path("folder", "renamed");
        assert_eq!(paths(&set), ["renamed/a.md", "b.md"]);
        assert_eq!(set.go_back().as_deref(), Some("renamed/a.md"));
        set.set_pinned(0, true);
        assert!(set.remove_path("renamed/a.md"));
        assert!(!set.remove_path("renamed/a.md"));
        assert_eq!(paths(&set), ["b.md"]);
        assert_eq!(set.active_path(), Some("b.md"));
        assert!(!set.can_go_back());
    }

    #[test]
    fn persistence_round_trips_tabs_pins_and_active() {
        let mut set = TabSet::new();
        set.open("a b.md");
        set.open("dir\\odd\nname.md");
        set.open("c.md");
        set.set_pinned(1, true);
        set.activate(1);
        let text = set.to_persisted_string();
        let restored = TabSet::from_persisted_string(&text);
        let restored = restored.unwrap_or_default();
        assert_eq!(restored.tabs(), set.tabs());
        assert_eq!(restored.active_index(), Some(1));
        assert!(!restored.can_go_back());
    }

    #[test]
    fn persistence_rejects_malformed_input() {
        assert_eq!(
            TabSet::from_persisted_string("nope"),
            Err(TabSetParseError::MissingHeader)
        );
        let bad_flag = format!("{PERSISTENCE_HEADER}\nactive 0\ntab 2 a.md\n");
        assert_eq!(
            TabSet::from_persisted_string(&bad_flag),
            Err(TabSetParseError::InvalidLine(3))
        );
        let bad_escape = format!("{PERSISTENCE_HEADER}\ntab 0 a\\x.md\n");
        assert_eq!(
            TabSet::from_persisted_string(&bad_escape),
            Err(TabSetParseError::InvalidLine(2))
        );
        let stale_active = format!("{PERSISTENCE_HEADER}\nactive 4\ntab 0 a.md\n\n");
        let restored = TabSet::from_persisted_string(&stale_active);
        assert_eq!(restored.map(|set| set.active_index()), Ok(None));
    }

    #[test]
    fn titles_strip_folders_and_markdown_extension() {
        assert_eq!(tab_title("folder/My note.md"), "My note");
        assert_eq!(tab_title("image.png"), "image.png");
    }
}
