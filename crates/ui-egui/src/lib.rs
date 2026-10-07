//! Native eframe application shell. Product workflows are migrated in later phases.

/// Creates the initial native desktop application.
pub fn run() -> eframe::Result {
    let options = eframe::NativeOptions::default();
    eframe::run_native(
        "OpenObsidian",
        options,
        Box::new(|_creation_context| Ok(Box::new(OpenObsidianApp))),
    )
}

#[derive(Default)]
struct OpenObsidianApp {
    session: Option<openobsidian_engine::VaultSession>,
}

impl eframe::App for OpenObsidianApp {
    fn update(&mut self, context: &eframe::egui::Context, _frame: &mut eframe::Frame) {
        eframe::egui::CentralPanel::default().show(context, |ui| {
            ui.heading("OpenObsidian");
            ui.label("Native Rust migration is in progress.");
            match &self.session {
                Some(session) => {
                    ui.label(format!("{} Markdown files found.", session.entries().len()));
                }
                None => {
                    ui.label("No vault is open in this preview.");
                }
            }
            ui.label("Editing and plugin compatibility are not available in this preview.");
        });
    }
}
