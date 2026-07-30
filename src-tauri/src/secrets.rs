use crate::error::{AppError, AppResult};

const SERVICE_NAME: &str = "com.aitranslator.desktop";

fn entry(provider_id: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(SERVICE_NAME, provider_id)
        .map_err(|error| AppError::new("secure_storage_unavailable", error.to_string()))
}

pub fn has_api_key(provider_id: &str) -> bool {
    get_api_key(provider_id).is_ok_and(|value| !value.is_empty())
}

pub fn get_api_key(provider_id: &str) -> AppResult<String> {
    entry(provider_id)?
        .get_password()
        .map_err(|error| AppError::new("api_key_unavailable", error.to_string()))
}

pub fn set_api_key(provider_id: &str, api_key: &str) -> AppResult<()> {
    if api_key.trim().is_empty() {
        return Err(AppError::invalid("API key cannot be empty"));
    }
    entry(provider_id)?
        .set_password(api_key)
        .map_err(|error| AppError::new("secure_storage_write_failed", error.to_string()))
}

pub fn delete_api_key(provider_id: &str) -> AppResult<()> {
    let entry = entry(provider_id)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(AppError::new(
            "secure_storage_delete_failed",
            error.to_string(),
        )),
    }
}
