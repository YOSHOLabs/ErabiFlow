use std::path::Path;

/// Move a fully-written file into place without exposing a partially-written destination.
/// The source and destination must be on the same volume.
#[cfg(windows)]
pub fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(format!(
            "ファイルを安全に置き換えられませんでした: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::rename(source, destination)
        .map_err(|error| format!("ファイルを安全に置き換えられませんでした: {error}"))
}

#[cfg(test)]
mod tests {
    use super::replace_file;

    #[test]
    fn replaces_an_existing_file_with_the_staged_file() {
        let directory =
            std::env::temp_dir().join(format!("erabiflow-atomic-replace-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let destination = directory.join("project.vfocus");
        let staged = directory.join("project.vfocus.tmp");
        std::fs::write(&destination, b"old").unwrap();
        std::fs::write(&staged, b"new").unwrap();

        replace_file(&staged, &destination).unwrap();

        assert_eq!(std::fs::read(&destination).unwrap(), b"new");
        assert!(!staged.exists());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
