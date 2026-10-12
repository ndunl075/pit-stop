use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Settings {
    pub theme: String,
    pub motion: String,
    pub sound: bool,
    pub volume: f64,
    pub preset: String,
    pub always_on_top: bool,
    pub fps: u32,
    pub infer_commands: bool,
    pub position: Option<(i32, i32)>,
    pub size: Option<(u32, u32)>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "midnight".into(),
            motion: "system".into(),
            sound: false,
            volume: 0.2,
            preset: "expanded".into(),
            always_on_top: false,
            fps: 60,
            infer_commands: true,
            position: None,
            size: None,
        }
    }
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if !["midnight", "paper", "ember"].contains(&self.theme.as_str())
            || !["system", "full", "reduced"].contains(&self.motion.as_str())
            || !["compact", "expanded", "capture"].contains(&self.preset.as_str())
            || ![30, 60].contains(&self.fps)
            || !self.volume.is_finite()
            || !(0.0..=1.0).contains(&self.volume)
        {
            return Err("Invalid preferences".into());
        }
        Ok(())
    }
    pub fn load(dir: &Path) -> Self {
        fs::read(dir.join("settings.json"))
            .ok()
            .and_then(|v| serde_json::from_slice::<Self>(&v).ok())
            .filter(|s| s.validate().is_ok())
            .unwrap_or_default()
    }
    pub fn save(&self, dir: &Path) -> Result<(), String> {
        self.validate()?;
        fs::create_dir_all(dir).map_err(|_| "Cannot create settings directory")?;
        let temp = dir.join(format!("settings-{}.tmp", uuid::Uuid::new_v4()));
        fs::write(
            &temp,
            serde_json::to_vec_pretty(self).map_err(|_| "Cannot encode settings")?,
        )
        .map_err(|_| "Cannot write settings")?;
        // rename replacement is atomic on both supported Windows and Unix targets.
        fs::rename(&temp, dir.join("settings.json"))
            .map_err(|_| "Cannot replace settings".to_string())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_bad_preferences() {
        let mut s = Settings::default();
        s.volume = f64::NAN;
        assert!(s.validate().is_err());
        s.volume = 0.2;
        s.theme = "remote".into();
        assert!(s.validate().is_err());
    }
    #[test]
    fn defaults_are_silent() {
        let s = Settings::default();
        assert!(!s.sound);
        assert!(s.validate().is_ok());
    }
}
