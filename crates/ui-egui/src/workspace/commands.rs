//! Command registry: ids, titles, default shortcuts, enabled predicates and fuzzy ranking.

use super::fuzzy::{compare_names, fuzzy_score};
use eframe::egui::{Key, KeyboardShortcut, Modifiers};

/// Built-in command ids. Hosts may register additional commands with their own ids; the
/// workspace reports those back as [`super::WorkspaceAction::RunCommand`].
pub mod ids {
    pub const QUICK_SWITCHER: &str = "switcher:open";
    pub const COMMAND_PALETTE: &str = "command-palette:open";
    pub const NEW_NOTE: &str = "file:new-note";
    pub const SAVE_NOTE: &str = "editor:save-file";
    pub const DELETE_NOTE: &str = "file:delete-note";
    pub const CLOSE_TAB: &str = "workspace:close-tab";
    pub const CLOSE_OTHER_TABS: &str = "workspace:close-other-tabs";
    pub const NEXT_TAB: &str = "workspace:next-tab";
    pub const PREVIOUS_TAB: &str = "workspace:previous-tab";
    pub const TOGGLE_PIN: &str = "workspace:toggle-pin";
    pub const NAVIGATE_BACK: &str = "app:go-back";
    pub const NAVIGATE_FORWARD: &str = "app:go-forward";
    pub const REVEAL_IN_EXPLORER: &str = "file-explorer:reveal-active-file";
    pub const TOGGLE_EXPLORER: &str = "app:toggle-left-sidebar";
    pub const TOGGLE_SIDE_PANE: &str = "app:toggle-right-sidebar";
    pub const SHOW_BACKLINKS: &str = "backlink:open";
    pub const SHOW_OUTGOING_LINKS: &str = "outgoing-links:open";
    pub const SHOW_TAGS: &str = "tag-pane:open";
    pub const SEARCH_VAULT: &str = "global-search:open";
}

/// Workspace facts that enabled predicates may inspect.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct CommandContext {
    pub has_active_note: bool,
    pub active_tab_pinned: bool,
    pub tab_count: usize,
    pub can_go_back: bool,
    pub can_go_forward: bool,
}

/// Decides whether a command can run in the given context.
pub type EnabledPredicate = fn(&CommandContext) -> bool;

/// One command palette entry.
#[derive(Clone, Debug)]
pub struct Command {
    pub id: String,
    pub title: String,
    pub shortcut: Option<KeyboardShortcut>,
    pub enabled: EnabledPredicate,
}

impl Command {
    /// A command that is always enabled and has no shortcut.
    pub fn new(id: impl Into<String>, title: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            shortcut: None,
            enabled: always_enabled,
        }
    }

    #[must_use]
    pub fn with_shortcut(mut self, modifiers: Modifiers, key: Key) -> Self {
        self.shortcut = Some(KeyboardShortcut::new(modifiers, key));
        self
    }

    #[must_use]
    pub fn with_enabled(mut self, enabled: EnabledPredicate) -> Self {
        self.enabled = enabled;
        self
    }

    pub fn is_enabled(&self, context: &CommandContext) -> bool {
        (self.enabled)(context)
    }
}

fn always_enabled(_: &CommandContext) -> bool {
    true
}

fn has_active_note(context: &CommandContext) -> bool {
    context.has_active_note
}

fn has_closable_active_tab(context: &CommandContext) -> bool {
    context.has_active_note && !context.active_tab_pinned
}

fn has_several_tabs(context: &CommandContext) -> bool {
    context.tab_count > 1
}

fn can_go_back(context: &CommandContext) -> bool {
    context.can_go_back
}

fn can_go_forward(context: &CommandContext) -> bool {
    context.can_go_forward
}

/// Ordered collection of commands with unique ids.
#[derive(Clone, Debug, Default)]
pub struct CommandRegistry {
    commands: Vec<Command>,
}

impl CommandRegistry {
    /// An empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// The built-in workspace commands with Obsidian's default shortcuts.
    pub fn with_defaults() -> Self {
        let command = Modifiers::COMMAND;
        let command_shift = Modifiers::COMMAND.plus(Modifiers::SHIFT);
        let command_alt = Modifiers::COMMAND.plus(Modifiers::ALT);
        let ctrl_shift = Modifiers::CTRL.plus(Modifiers::SHIFT);
        let mut registry = Self::new();
        for entry in [
            Command::new(ids::QUICK_SWITCHER, "Open quick switcher").with_shortcut(command, Key::O),
            Command::new(ids::COMMAND_PALETTE, "Open command palette")
                .with_shortcut(command, Key::P),
            Command::new(ids::NEW_NOTE, "Create new note").with_shortcut(command, Key::N),
            Command::new(ids::SAVE_NOTE, "Save current file")
                .with_shortcut(command, Key::S)
                .with_enabled(has_active_note),
            Command::new(ids::DELETE_NOTE, "Delete current file").with_enabled(has_active_note),
            Command::new(ids::CLOSE_TAB, "Close current tab")
                .with_shortcut(command, Key::W)
                .with_enabled(has_closable_active_tab),
            Command::new(ids::CLOSE_OTHER_TABS, "Close all other tabs")
                .with_enabled(has_several_tabs),
            Command::new(ids::NEXT_TAB, "Go to next tab")
                .with_shortcut(Modifiers::CTRL, Key::Tab)
                .with_enabled(has_several_tabs),
            Command::new(ids::PREVIOUS_TAB, "Go to previous tab")
                .with_shortcut(ctrl_shift, Key::Tab)
                .with_enabled(has_several_tabs),
            Command::new(ids::TOGGLE_PIN, "Toggle pin").with_enabled(has_active_note),
            Command::new(ids::NAVIGATE_BACK, "Navigate back")
                .with_shortcut(command_alt, Key::ArrowLeft)
                .with_enabled(can_go_back),
            Command::new(ids::NAVIGATE_FORWARD, "Navigate forward")
                .with_shortcut(command_alt, Key::ArrowRight)
                .with_enabled(can_go_forward),
            Command::new(ids::REVEAL_IN_EXPLORER, "Reveal current file in navigation")
                .with_enabled(has_active_note),
            Command::new(ids::TOGGLE_EXPLORER, "Toggle left sidebar"),
            Command::new(ids::TOGGLE_SIDE_PANE, "Toggle right sidebar"),
            Command::new(ids::SHOW_BACKLINKS, "Show backlinks"),
            Command::new(ids::SHOW_OUTGOING_LINKS, "Show outgoing links"),
            Command::new(ids::SHOW_TAGS, "Show tags"),
            Command::new(ids::SEARCH_VAULT, "Search in all files")
                .with_shortcut(command_shift, Key::F),
        ] {
            registry.register(entry);
        }
        registry
    }

    /// Adds a command, replacing (and returning) any command with the same id.
    pub fn register(&mut self, command: Command) -> Option<Command> {
        match self
            .commands
            .iter_mut()
            .find(|entry| entry.id == command.id)
        {
            Some(existing) => Some(std::mem::replace(existing, command)),
            None => {
                self.commands.push(command);
                None
            }
        }
    }

    /// Removes a command by id.
    pub fn unregister(&mut self, id: &str) -> Option<Command> {
        let index = self.commands.iter().position(|entry| entry.id == id)?;
        Some(self.commands.remove(index))
    }

    pub fn get(&self, id: &str) -> Option<&Command> {
        self.commands.iter().find(|entry| entry.id == id)
    }

    pub fn commands(&self) -> &[Command] {
        &self.commands
    }

    pub fn len(&self) -> usize {
        self.commands.len()
    }

    pub fn is_empty(&self) -> bool {
        self.commands.is_empty()
    }

    /// Enabled commands matching `query` (substring or subsequence of the title), best first.
    /// An empty query lists every enabled command alphabetically.
    pub fn rank(&self, query: &str, context: &CommandContext) -> Vec<&Command> {
        let mut scored: Vec<(u32, &Command)> = self
            .commands
            .iter()
            .filter(|command| command.is_enabled(context))
            .filter_map(|command| {
                let score = fuzzy_score(query, &command.title)?;
                Some((score, command))
            })
            .collect();
        scored.sort_by(|left, right| {
            let by_score = right.0.cmp(&left.0);
            by_score.then_with(|| compare_names(&left.1.title, &right.1.title))
        });
        scored.into_iter().map(|(_, command)| command).collect()
    }

    /// The enabled command bound to exactly this key press, preferring the most specific
    /// shortcut when several match logically (e.g. Ctrl+Shift+Tab over Ctrl+Tab).
    pub fn command_for_shortcut(
        &self,
        modifiers: Modifiers,
        key: Key,
        context: &CommandContext,
    ) -> Option<&Command> {
        self.commands
            .iter()
            .filter(|command| command.is_enabled(context))
            .filter(|command| {
                command.shortcut.is_some_and(|shortcut| {
                    shortcut.logical_key == key && modifiers.matches_logically(shortcut.modifiers)
                })
            })
            .max_by_key(|command| command.shortcut.map_or(0, specificity))
    }

    /// Shortcuts of enabled commands, most specific first, so that consuming them in order never
    /// lets Ctrl+Tab swallow Ctrl+Shift+Tab.
    pub fn shortcuts_by_specificity(
        &self,
        context: &CommandContext,
    ) -> Vec<(KeyboardShortcut, String)> {
        let mut shortcuts: Vec<(KeyboardShortcut, String)> = self
            .commands
            .iter()
            .filter(|command| command.is_enabled(context))
            .filter_map(|command| Some((command.shortcut?, command.id.clone())))
            .collect();
        shortcuts.sort_by_key(|(shortcut, _)| std::cmp::Reverse(specificity(*shortcut)));
        shortcuts
    }
}

fn specificity(shortcut: KeyboardShortcut) -> u8 {
    let modifiers = shortcut.modifiers;
    let primary = modifiers.ctrl || modifiers.command || modifiers.mac_cmd;
    u8::from(primary) + u8::from(modifiers.shift) + u8::from(modifiers.alt)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn titles<'a>(commands: &[&'a Command]) -> Vec<&'a str> {
        commands
            .iter()
            .map(|command| command.title.as_str())
            .collect()
    }

    #[test]
    fn defaults_have_unique_ids_and_expected_shortcuts() {
        let registry = CommandRegistry::with_defaults();
        let mut seen = std::collections::BTreeSet::new();
        assert!(
            registry
                .commands()
                .iter()
                .all(|command| seen.insert(command.id.clone()))
        );
        assert_eq!(
            registry
                .get(ids::QUICK_SWITCHER)
                .and_then(|command| command.shortcut),
            Some(KeyboardShortcut::new(Modifiers::COMMAND, Key::O))
        );
        assert_eq!(
            registry
                .get(ids::COMMAND_PALETTE)
                .and_then(|command| command.shortcut),
            Some(KeyboardShortcut::new(Modifiers::COMMAND, Key::P))
        );
        assert!(!registry.is_empty());
    }

    #[test]
    fn register_replaces_by_id_and_unregister_removes() {
        let mut registry = CommandRegistry::new();
        assert!(registry.register(Command::new("x", "First")).is_none());
        let replaced = registry.register(Command::new("x", "Second"));
        assert_eq!(
            replaced.map(|command| command.title),
            Some("First".to_owned())
        );
        assert_eq!(registry.len(), 1);
        assert_eq!(
            registry.get("x").map(|command| command.title.as_str()),
            Some("Second")
        );
        assert!(registry.unregister("x").is_some());
        assert!(registry.unregister("x").is_none());
        assert!(registry.is_empty());
    }

    #[test]
    fn rank_filters_disabled_and_orders_by_match_quality() {
        let registry = CommandRegistry::with_defaults();
        let idle = CommandContext::default();
        let ranked = registry.rank("tab", &idle);
        assert!(titles(&ranked).is_empty(), "{:?}", titles(&ranked));

        let busy = CommandContext {
            has_active_note: true,
            tab_count: 3,
            ..CommandContext::default()
        };
        let ranked = registry.rank("tab", &busy);
        assert_eq!(
            titles(&ranked),
            [
                "Go to next tab",
                "Close current tab",
                "Go to previous tab",
                "Close all other tabs"
            ]
        );

        let ranked = registry.rank("ocp", &busy);
        assert_eq!(titles(&ranked).first(), Some(&"Open command palette"));

        let all = registry.rank("", &busy);
        assert_eq!(
            all.first().map(|command| command.title.as_str()),
            Some("Close all other tabs")
        );
    }

    #[test]
    fn shortcut_lookup_prefers_specific_bindings_and_respects_enabled() {
        let registry = CommandRegistry::with_defaults();
        let tabs = CommandContext {
            has_active_note: true,
            tab_count: 2,
            ..CommandContext::default()
        };
        let previous =
            registry.command_for_shortcut(Modifiers::CTRL.plus(Modifiers::SHIFT), Key::Tab, &tabs);
        assert_eq!(
            previous.map(|command| command.id.as_str()),
            Some(ids::PREVIOUS_TAB)
        );
        let next = registry.command_for_shortcut(Modifiers::CTRL, Key::Tab, &tabs);
        assert_eq!(next.map(|command| command.id.as_str()), Some(ids::NEXT_TAB));
        let none =
            registry.command_for_shortcut(Modifiers::CTRL, Key::Tab, &CommandContext::default());
        assert!(none.is_none());

        let ordered = registry.shortcuts_by_specificity(&tabs);
        let previous_position = ordered.iter().position(|(_, id)| id == ids::PREVIOUS_TAB);
        let next_position = ordered.iter().position(|(_, id)| id == ids::NEXT_TAB);
        assert!(previous_position < next_position);
        assert!(ordered.iter().all(|(_, id)| id != ids::NAVIGATE_BACK));
    }
}
