use std::{collections::BTreeMap, fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryRow {
    pub id: String,
    pub terms: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryData {
    pub languages: Vec<String>,
    pub concepts: Vec<GlossaryRow>,
}

#[derive(Clone)]
pub struct GlossaryStore {
    path: PathBuf,
}

impl GlossaryStore {
    pub fn new(app: &AppHandle) -> AppResult<Self> {
        let directory = app
            .path()
            .app_config_dir()
            .map_err(|error| AppError::new("config_directory_unavailable", error.to_string()))?;
        fs::create_dir_all(&directory).map_err(AppError::io)?;
        Ok(Self {
            path: directory.join("glossary.csv"),
        })
    }

    pub fn load(&self) -> AppResult<GlossaryData> {
        if !self.path.exists() {
            return Ok(GlossaryData::default());
        }
        let text = fs::read_to_string(&self.path).map_err(AppError::io)?;
        Self::parse(&text)
    }

    pub fn parse(text: &str) -> AppResult<GlossaryData> {
        let mut reader = csv::Reader::from_reader(text.as_bytes());
        let headers = reader
            .headers()
            .map_err(|error| AppError::new("glossary_read_failed", error.to_string()))?
            .clone();
        let records = reader
            .records()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| AppError::new("glossary_read_failed", error.to_string()))?;
        let columns = headers
            .iter()
            .enumerate()
            .filter(|(index, _)| {
                records.iter().any(|record| {
                    record
                        .get(*index)
                        .is_some_and(|value| !value.trim().is_empty())
                })
            })
            .map(|(index, language)| {
                (
                    index,
                    language
                        .strip_prefix('\u{feff}')
                        .unwrap_or(language)
                        .to_owned(),
                )
            })
            .collect::<Vec<_>>();
        let languages = columns
            .iter()
            .map(|(_, language)| language.clone())
            .collect::<Vec<_>>();
        let mut concepts = Vec::new();
        for record in records {
            let terms = columns
                .iter()
                .map(|(index, language)| {
                    (
                        language.clone(),
                        record.get(*index).unwrap_or_default().to_owned(),
                    )
                })
                .collect();
            concepts.push(GlossaryRow {
                id: uuid::Uuid::new_v4().to_string(),
                terms,
            });
        }
        Ok(GlossaryData {
            languages,
            concepts,
        })
    }

    pub fn export(glossary: &GlossaryData) -> AppResult<String> {
        let mut writer = csv::Writer::from_writer(Vec::new());
        writer
            .write_record(&glossary.languages)
            .map_err(|error| AppError::new("glossary_write_failed", error.to_string()))?;
        for concept in &glossary.concepts {
            writer
                .write_record(
                    glossary
                        .languages
                        .iter()
                        .map(|language| concept.terms.get(language).map_or("", String::as_str)),
                )
                .map_err(|error| AppError::new("glossary_write_failed", error.to_string()))?;
        }
        let bytes = writer
            .into_inner()
            .map_err(|error| AppError::new("glossary_write_failed", error.to_string()))?;
        let csv = String::from_utf8(bytes)
            .map_err(|error| AppError::new("glossary_write_failed", error.to_string()))?;
        Ok(format!("\u{feff}{csv}"))
    }

    pub fn save(&self, glossary: &GlossaryData) -> AppResult<()> {
        crate::storage::atomic_write(&self.path, Self::export(glossary)?.as_bytes(), "glossary")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_round_trip_preserves_quotes_and_newlines() {
        let glossary = GlossaryData {
            languages: vec!["en".into(), "zh-CN".into()],
            concepts: vec![GlossaryRow {
                id: "ignored-in-csv".into(),
                terms: BTreeMap::from([
                    ("en".into(), "AI, \"agent\"".into()),
                    ("zh-CN".into(), "人工\n智能体".into()),
                ]),
            }],
        };
        let encoded = GlossaryStore::export(&glossary).unwrap();
        let decoded = GlossaryStore::parse(&encoded).unwrap();
        assert_eq!(decoded.languages, glossary.languages);
        assert_eq!(decoded.concepts[0].terms, glossary.concepts[0].terms);
    }

    #[test]
    fn parse_ignores_empty_language_columns() {
        let text = "en,zh-CN,ja\r\nhello,, \r\nworld,,\r\n";
        let parsed = GlossaryStore::parse(text).unwrap();

        assert_eq!(parsed.languages, vec!["en"]);
        assert_eq!(parsed.concepts[0].terms.get("en"), Some(&"hello".into()));
        assert_eq!(parsed.concepts[0].terms.contains_key("zh-CN"), false);
        assert_eq!(parsed.concepts[0].terms.contains_key("ja"), false);
    }
}
