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
        let languages = reader
            .headers()
            .map_err(|error| AppError::new("glossary_read_failed", error.to_string()))?
            .iter()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let mut concepts = Vec::new();
        for record in reader.records() {
            let record =
                record.map_err(|error| AppError::new("glossary_read_failed", error.to_string()))?;
            let terms = languages
                .iter()
                .zip(record.iter())
                .map(|(language, value)| (language.clone(), value.to_owned()))
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
        String::from_utf8(bytes)
            .map_err(|error| AppError::new("glossary_write_failed", error.to_string()))
    }

    pub fn save(&self, glossary: &GlossaryData) -> AppResult<()> {
        crate::storage::atomic_write(
            &self.path,
            Self::export(glossary)?.as_bytes(),
            "glossary",
        )
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
}
