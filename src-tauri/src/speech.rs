use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechCapabilities {
    pub supported: bool,
    pub backend: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechRequest {
    pub variant_id: String,
    pub text: String,
    pub language: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeechStateEvent {
    status: &'static str,
    variant_id: Option<String>,
    error: Option<String>,
}

fn emit_state(
    app: &AppHandle,
    status: &'static str,
    variant_id: Option<String>,
    error: Option<String>,
) {
    let _ = app.emit(
        "speech-state",
        SpeechStateEvent {
            status,
            variant_id,
            error,
        },
    );
}

fn language_tag(language: &str) -> String {
    match language {
        "en" => "en-US",
        "zh-CN" => "zh-CN",
        "zh-TW" => "zh-TW",
        "ja" => "ja-JP",
        "ko" => "ko-KR",
        "es" => "es-ES",
        "de" => "de-DE",
        "fr" => "fr-FR",
        "pt-BR" | "pt" => "pt-BR",
        "ru" => "ru-RU",
        "hi" => "hi-IN",
        "id" => "id-ID",
        "vi" => "vi-VN",
        "th" => "th-TH",
        "tr" => "tr-TR",
        "it" => "it-IT",
        "pl" => "pl-PL",
        "uk" => "uk-UA",
        "nl" => "nl-NL",
        "ms" => "ms-MY",
        value => value,
    }
    .to_owned()
}

fn split_utterances(text: &str) -> Vec<String> {
    const MAX_CHARS: usize = 800;
    const MIN_SENTENCE_CHARS: usize = 120;
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut length = 0;
    for character in text.chars() {
        current.push(character);
        length += 1;
        let sentence_boundary = matches!(character, '.' | '!' | '?' | '。' | '！' | '？' | '\n');
        if length >= MAX_CHARS || (length >= MIN_SENTENCE_CHARS && sentence_boundary) {
            let chunk = current.trim().to_owned();
            if !chunk.is_empty() {
                chunks.push(chunk);
            }
            current.clear();
            length = 0;
        }
    }
    let remainder = current.trim().to_owned();
    if !remainder.is_empty() {
        chunks.push(remainder);
    }
    chunks
}

#[cfg(windows)]
mod platform {
    use std::sync::mpsc;

    use tauri::AppHandle;
    use windows::{
        core::{HSTRING, PCWSTR},
        Foundation::TypedEventHandler,
        Media::{Core::MediaSource, Playback::MediaPlayer, SpeechSynthesis::SpeechSynthesizer},
        Win32::{
            Media::Speech::{ISpVoice, SPF_ASYNC, SPF_PURGEBEFORESPEAK},
            System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
        },
    };

    use super::{emit_state, language_tag, split_utterances, SpeechCapabilities, SpeechRequest};
    use crate::error::{AppError, AppResult};

    const CLSID_SPVOICE: windows::core::GUID =
        windows::core::GUID::from_u128(0x96749377_3391_11d2_9ee3_00c04f797396);

    enum Command {
        Speak(SpeechRequest),
        Stop,
    }

    pub struct Manager {
        sender: mpsc::Sender<Command>,
    }

    impl Manager {
        pub fn new(app: AppHandle) -> Self {
            let (sender, receiver) = mpsc::channel();
            std::thread::spawn(move || worker(app, receiver));
            Self { sender }
        }

        pub fn capabilities(&self) -> SpeechCapabilities {
            SpeechCapabilities {
                supported: true,
                backend: "windows-media-speech-synthesis+sapi".into(),
            }
        }

        pub fn speak(&self, request: SpeechRequest) -> AppResult<()> {
            if request.text.trim().is_empty() {
                return Err(AppError::invalid("speech text cannot be empty"));
            }
            self.sender
                .send(Command::Speak(request))
                .map_err(|_| AppError::new("speech_unavailable", "speech worker stopped"))
        }

        pub fn stop(&self) -> AppResult<()> {
            self.sender
                .send(Command::Stop)
                .map_err(|_| AppError::new("speech_unavailable", "speech worker stopped"))
        }
    }

    fn worker(app: AppHandle, receiver: mpsc::Receiver<Command>) {
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let mut player: Option<MediaPlayer> = None;
        let mut sapi: Option<ISpVoice> = None;
        while let Ok(command) = receiver.recv() {
            match command {
                Command::Stop => {
                    stop_current(&mut player, sapi.as_ref());
                    emit_state(&app, "stopped", None, None);
                }
                Command::Speak(request) => {
                    stop_current(&mut player, sapi.as_ref());
                    let variant_id = request.variant_id.clone();
                    match speak_winrt(&app, &request) {
                        Ok(next_player) => {
                            player = Some(next_player);
                            emit_state(&app, "playing", Some(variant_id), None);
                        }
                        Err(winrt_error) => match speak_sapi(&request, sapi.as_ref()) {
                            Ok(voice) => {
                                sapi = Some(voice);
                                emit_state(&app, "playing", Some(variant_id), None);
                            }
                            Err(sapi_error) => emit_state(
                                &app,
                                "error",
                                Some(variant_id),
                                Some(format!("WinRT: {winrt_error}; SAPI: {sapi_error}")),
                            ),
                        },
                    }
                }
            }
        }
    }

    fn stop_current(player: &mut Option<MediaPlayer>, sapi: Option<&ISpVoice>) {
        if let Some(current) = player.take() {
            let _ = current.Pause();
            let _ = current.Close();
        }
        if let Some(voice) = sapi {
            unsafe {
                let _ = voice.Speak(
                    PCWSTR::null(),
                    SPF_ASYNC.0 as u32 | SPF_PURGEBEFORESPEAK.0 as u32,
                    None,
                );
            }
        }
    }

    fn speak_winrt(app: &AppHandle, request: &SpeechRequest) -> windows::core::Result<MediaPlayer> {
        let synthesizer = SpeechSynthesizer::new()?;
        let requested = language_tag(&request.language).to_ascii_lowercase();
        let primary = requested.split('-').next().unwrap_or_default();
        let voices = SpeechSynthesizer::AllVoices()?;
        let mut exact = None;
        let mut fallback = None;
        for index in 0..voices.Size()? {
            let voice = voices.GetAt(index)?;
            let language = voice.Language()?.to_string().to_ascii_lowercase();
            if language == requested {
                exact = Some(voice);
                break;
            }
            if fallback.is_none() && language.split('-').next() == Some(primary) {
                fallback = Some(voice);
            }
        }
        if let Some(voice) = exact.or(fallback) {
            synthesizer.SetVoice(&voice)?;
        }
        let stream = synthesizer
            .SynthesizeTextToStreamAsync(&HSTRING::from(&request.text))?
            .get()?;
        let source = MediaSource::CreateFromStream(&stream, &stream.ContentType()?)?;
        let player = MediaPlayer::new()?;
        player.SetSource(&source)?;
        let app = app.clone();
        let variant_id = request.variant_id.clone();
        player.MediaEnded(&TypedEventHandler::new(move |_, _| {
            emit_state(&app, "stopped", Some(variant_id.clone()), None);
            Ok(())
        }))?;
        player.Play()?;
        Ok(player)
    }

    fn speak_sapi(
        request: &SpeechRequest,
        existing: Option<&ISpVoice>,
    ) -> windows::core::Result<ISpVoice> {
        let voice = if let Some(existing) = existing {
            existing.clone()
        } else {
            unsafe { CoCreateInstance(&CLSID_SPVOICE, None, CLSCTX_ALL)? }
        };
        let wide = split_utterances(&request.text)
            .join("\n")
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        unsafe {
            voice.Speak(
                PCWSTR(wide.as_ptr()),
                SPF_ASYNC.0 as u32 | SPF_PURGEBEFORESPEAK.0 as u32,
                None,
            )?;
        }
        Ok(voice)
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::{
        ffi::{c_char, c_void, CString},
        sync::{
            atomic::{AtomicU64, AtomicUsize, Ordering},
            Arc,
        },
        time::Duration,
    };

    use tauri::AppHandle;

    use super::{emit_state, language_tag, split_utterances, SpeechCapabilities, SpeechRequest};
    use crate::error::{AppError, AppResult};

    type Id = *mut c_void;
    type Sel = *mut c_void;

    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {}

    #[link(name = "objc")]
    extern "C" {
        fn sel_registerName(name: *const c_char) -> Sel;
        fn objc_getClass(name: *const c_char) -> Id;
        fn objc_msgSend();
    }

    unsafe fn selector(name: &'static [u8]) -> Sel {
        sel_registerName(name.as_ptr().cast())
    }

    unsafe fn send_id(target: Id, selector_name: &'static [u8]) -> Id {
        let call: unsafe extern "C" fn(Id, Sel) -> Id =
            std::mem::transmute(objc_msgSend as *const ());
        call(target, selector(selector_name))
    }

    unsafe fn send_id_arg(target: Id, selector_name: &'static [u8], value: Id) -> Id {
        let call: unsafe extern "C" fn(Id, Sel, Id) -> Id =
            std::mem::transmute(objc_msgSend as *const ());
        call(target, selector(selector_name), value)
    }

    unsafe fn send_void_arg(target: Id, selector_name: &'static [u8], value: Id) {
        let call: unsafe extern "C" fn(Id, Sel, Id) =
            std::mem::transmute(objc_msgSend as *const ());
        call(target, selector(selector_name), value);
    }

    unsafe fn send_bool(target: Id, selector_name: &'static [u8]) -> bool {
        let call: unsafe extern "C" fn(Id, Sel) -> bool =
            std::mem::transmute(objc_msgSend as *const ());
        call(target, selector(selector_name))
    }

    unsafe fn stop(target: Id) {
        let call: unsafe extern "C" fn(Id, Sel, isize) -> bool =
            std::mem::transmute(objc_msgSend as *const ());
        let _ = call(target, selector(b"stopSpeakingAtBoundary:\0"), 0);
    }

    unsafe fn ns_string(value: &str) -> Option<Id> {
        let value = CString::new(value).ok()?;
        let class = objc_getClass(b"NSString\0".as_ptr().cast());
        let call: unsafe extern "C" fn(Id, Sel, *const c_char) -> Id =
            std::mem::transmute(objc_msgSend as *const ());
        Some(call(
            class,
            selector(b"stringWithUTF8String:\0"),
            value.as_ptr(),
        ))
    }

    pub struct Manager {
        app: AppHandle,
        synthesizer: Arc<AtomicUsize>,
        generation: Arc<AtomicU64>,
    }

    impl Manager {
        pub fn new(app: AppHandle) -> Self {
            Self {
                app,
                synthesizer: Arc::new(AtomicUsize::new(0)),
                generation: Arc::new(AtomicU64::new(0)),
            }
        }

        pub fn capabilities(&self) -> SpeechCapabilities {
            SpeechCapabilities {
                supported: true,
                backend: "av-speech-synthesizer".into(),
            }
        }

        pub fn speak(&self, request: SpeechRequest) -> AppResult<()> {
            if request.text.trim().is_empty() {
                return Err(AppError::invalid("speech text cannot be empty"));
            }
            let app = self.app.clone();
            let pointer = self.synthesizer.clone();
            let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
            let generation_state = self.generation.clone();
            let variant_id = request.variant_id.clone();
            let poll_variant = variant_id.clone();
            self.app
                .run_on_main_thread(move || unsafe {
                    let mut synth = pointer.load(Ordering::Relaxed) as Id;
                    if synth.is_null() {
                        let class = objc_getClass(b"AVSpeechSynthesizer\0".as_ptr().cast());
                        synth = send_id(send_id(class, b"alloc\0"), b"init\0");
                        pointer.store(synth as usize, Ordering::Relaxed);
                    } else {
                        stop(synth);
                    }
                    let Some(text) = ns_string(&split_utterances(&request.text).join("\n")) else {
                        emit_state(
                            &app,
                            "error",
                            Some(variant_id),
                            Some("speech text contains a null character".into()),
                        );
                        return;
                    };
                    let utterance_class = objc_getClass(b"AVSpeechUtterance\0".as_ptr().cast());
                    let utterance =
                        send_id_arg(utterance_class, b"speechUtteranceWithString:\0", text);
                    if let Some(language) = ns_string(&language_tag(&request.language)) {
                        let voice_class =
                            objc_getClass(b"AVSpeechSynthesisVoice\0".as_ptr().cast());
                        let voice = send_id_arg(voice_class, b"voiceWithLanguage:\0", language);
                        if !voice.is_null() {
                            send_void_arg(utterance, b"setVoice:\0", voice);
                        }
                    }
                    send_void_arg(synth, b"speakUtterance:\0", utterance);
                    emit_state(&app, "playing", Some(variant_id), None);
                })
                .map_err(|error| AppError::new("speech_failed", error.to_string()))?;

            let app = self.app.clone();
            let pointer = self.synthesizer.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_millis(120));
                if generation_state.load(Ordering::Relaxed) != generation {
                    break;
                }
                let (sender, receiver) = std::sync::mpsc::sync_channel(1);
                let pointer_value = pointer.load(Ordering::Relaxed);
                let _ = app.run_on_main_thread(move || unsafe {
                    let speaking =
                        pointer_value != 0 && send_bool(pointer_value as Id, b"isSpeaking\0");
                    let _ = sender.send(speaking);
                });
                if receiver.recv_timeout(Duration::from_secs(1)).ok() == Some(false) {
                    emit_state(&app, "stopped", Some(poll_variant), None);
                    break;
                }
            });
            Ok(())
        }

        pub fn stop(&self) -> AppResult<()> {
            self.generation.fetch_add(1, Ordering::Relaxed);
            let pointer = self.synthesizer.load(Ordering::Relaxed);
            let app = self.app.clone();
            self.app
                .run_on_main_thread(move || unsafe {
                    if pointer != 0 {
                        stop(pointer as Id);
                    }
                    emit_state(&app, "stopped", None, None);
                })
                .map_err(|error| AppError::new("speech_failed", error.to_string()))
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use tauri::AppHandle;

    use super::{SpeechCapabilities, SpeechRequest};
    use crate::error::{AppError, AppResult};

    pub struct Manager;

    impl Manager {
        pub fn new(_app: AppHandle) -> Self {
            Self
        }

        pub fn capabilities(&self) -> SpeechCapabilities {
            SpeechCapabilities {
                supported: false,
                backend: "unsupported".into(),
            }
        }

        pub fn speak(&self, _request: SpeechRequest) -> AppResult<()> {
            Err(AppError::new(
                "speech_unsupported",
                "system speech is not supported on this platform",
            ))
        }

        pub fn stop(&self) -> AppResult<()> {
            Ok(())
        }
    }
}

pub struct SpeechManager {
    platform: platform::Manager,
}

impl SpeechManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            platform: platform::Manager::new(app),
        }
    }

    pub fn capabilities(&self) -> SpeechCapabilities {
        self.platform.capabilities()
    }

    pub fn speak(&self, request: SpeechRequest) -> AppResult<()> {
        self.platform.speak(request)
    }

    pub fn stop(&self) -> AppResult<()> {
        self.platform.stop()
    }
}

#[cfg(test)]
mod tests {
    use super::{language_tag, split_utterances};

    #[test]
    fn expands_generic_language_tags() {
        assert_eq!(language_tag("en"), "en-US");
        assert_eq!(language_tag("fr"), "fr-FR");
        assert_eq!(language_tag("zh-CN"), "zh-CN");
    }

    #[test]
    fn splits_long_speech_without_empty_chunks() {
        let chunks = split_utterances(&"a".repeat(1_700));
        assert_eq!(chunks.len(), 3);
        assert!(chunks.iter().all(|chunk| !chunk.is_empty()));
        assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 800));
    }
}
