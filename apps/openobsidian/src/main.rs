fn main() {
    if let Err(error) = openobsidian_ui_egui::run() {
        eprintln!("OpenObsidian could not start: {error}");
        std::process::exit(1);
    }
}
