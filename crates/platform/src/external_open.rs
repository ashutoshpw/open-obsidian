use std::path::Path;

/// Opens a validated file with the operating system's default application.
///
/// The caller is responsible for applying its own path-confinement policy before
/// handing a path to this platform service.
pub fn open_external_file(path: &Path) -> Result<(), String> {
    open::that(path).map_err(|error| format!("system file opener failed: {error}"))
}
