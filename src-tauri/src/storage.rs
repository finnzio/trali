use std::{
    fs::{self, File},
    io::Write,
    path::Path,
};

use crate::error::{AppError, AppResult};

pub fn atomic_write(path: &Path, bytes: &[u8], prefix: &str) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "storage path has no parent"))?;
    fs::create_dir_all(parent).map_err(AppError::io)?;
    let temporary = parent.join(format!(".{prefix}-{}.tmp", uuid::Uuid::new_v4()));
    {
        let mut file = File::create(&temporary).map_err(AppError::io)?;
        file.write_all(bytes).map_err(AppError::io)?;
        file.sync_all().map_err(AppError::io)?;
    }
    if let Err(error) = replace_file(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> AppResult<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(destination.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|error| AppError::new("atomic_replace_failed", error.to_string()))
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> AppResult<()> {
    fs::rename(source, destination).map_err(AppError::io)
}
