#[allow(dead_code)]
#[path = "../../../src-tauri/src/credentials.rs"]
mod credentials;

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use serde_json::{json, Value};

#[cfg(target_os = "macos")]
#[link(name = "Security", kind = "framework")]
extern "C" {
    fn SecKeychainSetUserInteractionAllowed(state: u8) -> i32;
}

fn guard(ci: &str, runner: &str, hosted: &str, opt_in: &str, platform: &str, run: &str, phase: &str) -> Result<(), String> {
    if ci != "true" || hosted != "github-hosted" || opt_in != "1"
        || !matches!(platform, "Windows" | "macOS") || runner != platform {
        return Err("Requires an opted-in disposable GitHub-hosted Windows/macOS runner".into());
    }
    if run.len() != 32 || !run.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) {
        return Err("Requires a fresh 32-character lowercase hex acceptance run id".into());
    }
    if !matches!(phase, "migrate" | "recover" | "malformed" | "cleanup" | "unavailable")
        || (phase == "unavailable" && platform != "macOS") {
        return Err("Unknown or unsupported acceptance phase".into());
    }
    Ok(())
}

// Reject symlinks and Windows junctions for every harness-owned path we open.
fn plain(path: &Path, directory: bool) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "Missing acceptance path")?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 { return Err("Acceptance reparse point refused".into()); }
    }
    if meta.file_type().is_symlink() || (directory && !meta.is_dir()) || (!directory && !meta.is_file()) {
        return Err("Acceptance path type refused".into());
    }
    Ok(())
}

struct Context { run: String, service: String, account: String, dir: PathBuf }
impl Context {
    fn load(phase: &str) -> Result<Self, String> {
        let env = |key| std::env::var(key).unwrap_or_default();
        let platform = if cfg!(target_os = "windows") { "Windows" } else if cfg!(target_os = "macos") { "macOS" } else { "unsupported" };
        let run = env("STARNET_ACCEPTANCE_RUN_ID");
        guard(&env("GITHUB_ACTIONS"), &env("RUNNER_OS"), &env("RUNNER_ENVIRONMENT"),
            &env("STARNET_DISPOSABLE_KEYCHAIN"), platform, &run, phase)?;
        let temp = PathBuf::from(env("RUNNER_TEMP"));
        if !temp.is_absolute() { return Err("Requires an absolute runner temp root".into()); }
        let temp = temp.canonicalize().map_err(|_| "Cannot resolve runner temp root")?;
        plain(&temp, true)?;
        Ok(Self {
            service: format!("ai.skynet.harness.acceptance.{run}"),
            account: format!("connectors:acceptance:{run}"),
            dir: temp.join(format!("starnet-connector-keychain-{run}")), run,
        })
    }
    fn receipt(&self, name: &str, value: Value) -> Result<(), String> {
        plain(&self.dir, true)?;
        let mut file = OpenOptions::new().write(true).create_new(true).open(self.dir.join(name))
            .map_err(|_| "Cannot create exclusive acceptance receipt")?;
        file.write_all(serde_json::to_string_pretty(&value).map_err(|_| "Cannot encode receipt")?.as_bytes())
            .and_then(|_| file.sync_all()).map_err(|_| "Cannot persist acceptance receipt".into())
    }
    fn read(&self, name: &str) -> Result<Value, String> {
        plain(&self.dir, true)?;
        let file = self.dir.join(name);
        plain(&file, false)?;
        serde_json::from_str(&fs::read_to_string(file).map_err(|_| "Cannot read receipt")?)
            .map_err(|_| "Invalid acceptance receipt".into())
    }
    fn owned(&self) -> Result<(), String> {
        let owner = self.read("owner.json")?;
        if owner["run"] != self.run || owner["service"] != self.service || owner["account"] != self.account
            || owner["absenceVerified"] != true {
            return Err("Synthetic entry ownership was not proven; refusing modification".into());
        }
        Ok(())
    }
    fn vault(&self, phase: &str, key: &str) -> Result<(), String> {
        let status = std::process::Command::new("node")
            .arg("test/native-connector-keychain/vault-check.cjs").arg(phase)
            .env("STARNET_CONNECTOR_ENCRYPTION_KEY", key)
            .status().map_err(|_| "Cannot run vault acceptance")?;
        if !status.success() { return Err("Vault acceptance failed; synthetic evidence preserved".into()); }
        Ok(())
    }
    fn run(&self, phase: &str) -> Result<(), String> {
        // All guards precede Entry creation. The production service/account is never passed here.
        if phase != "migrate" {
            self.owned()?;
            let sealed = self.read("sealed.json")?;
            if sealed["sealed"] != true || sealed["pid"].as_u64().unwrap_or(0) == 0 {
                return Err("Missing successful sealing receipt; refusing modification".into());
            }
        }
        let entry = keyring::Entry::new(&self.service, &self.account).map_err(|_| "Cannot open synthetic entry")?;
        if phase == "migrate" {
            if !matches!(entry.get_password(), Err(keyring::Error::NoEntry)) {
                return Err("Synthetic entry is not absent; refusing to adopt or overwrite it".into());
            }
            fs::create_dir(&self.dir).map_err(|_| "Requires a fresh acceptance directory")?;
            self.receipt("owner.json", json!({"run": self.run, "service": self.service, "account": self.account,
                "absenceVerified": true, "pid": std::process::id(), "platform": std::env::consts::OS,
                "sourceSha": std::env::var("GITHUB_SHA").unwrap_or_default()}))?;
            let key = credentials::connector_encryption_key_for_entry(&entry)?;
            self.vault("migrate", &key)?;
            self.receipt("sealed.json", json!({"pid": std::process::id(), "sealed": true}))?;
        } else if phase == "unavailable" {
            if credentials::connector_encryption_key_for_entry(&entry).is_ok() {
                return Err("Locked disposable macOS keychain unexpectedly returned a key".into());
            }
            println!("PASS actual locked disposable macOS keychain refused access");
        } else {
            // Later phases must never manufacture a replacement if persistence was lost.
            let before = entry.get_password().map_err(|_| "Owned key missing or inaccessible; refusing replacement")?;
            let key = credentials::connector_encryption_key_for_entry(&entry)?;
            if key != before { return Err("Owned key changed between reads".into()); }
            self.vault("recover", &key)?;
            if phase == "recover" {
                let first = self.read("sealed.json")?["pid"].as_u64().ok_or("Missing first-process identity")?;
                if first == u64::from(std::process::id()) { return Err("Recovery requires a different native process".into()); }
                self.receipt(&format!("recovered-{}.json", std::process::id()), json!({"sealedPid": first,
                    "recoveredPid": std::process::id(), "decrypted": true}))?;
            } else if phase == "malformed" {
                let seeded = entry.set_password("INVALID_ACCEPTANCE_KEY").is_ok();
                let rejected = credentials::connector_encryption_key_for_entry(&entry).is_err();
                let preserved = entry.get_password().map(|v| v == "INVALID_ACCEPTANCE_KEY").unwrap_or(false);
                // Attempt restoration even if seeding or the negative check failed. Never delete on failure.
                let restored = entry.set_password(&key).is_ok()
                    && entry.get_password().map(|v| v == key).unwrap_or(false);
                self.receipt("malformed.json", json!({"seeded": seeded, "rejected": rejected,
                    "preserved": preserved, "restored": restored}))?;
                if !seeded || !rejected || !preserved || !restored {
                    return Err("Malformed-value acceptance failed; restore result recorded; evidence retained".into());
                }
                self.vault("recover", &key)?;
            } else if phase == "cleanup" {
                // Ownership plus successful decryption of this run's sealed vault is required above.
                entry.delete_credential().map_err(|_| "Synthetic entry cleanup failed")?;
                if !matches!(entry.get_password(), Err(keyring::Error::NoEntry)) {
                    return Err("Synthetic entry cleanup could not be verified".into());
                }
                self.receipt("cleanup.json", json!({"exactSyntheticEntryRemoved": true}))?;
            }
        }
        println!("PASS native component phase {phase}; synthetic namespace only");
        Ok(())
    }
}

fn main() -> Result<(), String> {
    let phase = std::env::args().nth(1).ok_or("Missing acceptance phase")?;
    let context = Context::load(&phase)?;
    #[cfg(target_os = "macos")]
    unsafe {
        if SecKeychainSetUserInteractionAllowed(0) != 0 {
            return Err("Could not disable interactive keychain prompts".into());
        }
    }
    if let Err(error) = context.run(&phase) {
        if context.owned().is_ok() {
            let receipt = context.receipt(&format!("failure-{phase}-{}.json", std::process::id()),
                json!({"phase": phase, "error": error, "evidencePreserved": true}));
            if receipt.is_err() { eprintln!("Could not persist failure receipt; existing evidence left untouched"); }
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod acceptance_guards {
    use super::guard;
    #[test]
    fn refuses_unowned_context_before_any_entry_access() {
        let run = "a1".repeat(16);
        assert!(guard("true", "Windows", "github-hosted", "1", "Windows", &run, "migrate").is_ok());
        for (ci, runner, hosted, opt, platform, id, phase) in [
            ("false", "Windows", "github-hosted", "1", "Windows", run.as_str(), "migrate"),
            ("true", "Windows", "self-hosted", "1", "Windows", run.as_str(), "migrate"),
            ("true", "Windows", "github-hosted", "0", "Windows", run.as_str(), "migrate"),
            ("true", "macOS", "github-hosted", "1", "Windows", run.as_str(), "migrate"),
            ("true", "Windows", "github-hosted", "1", "Windows", "../escape", "migrate"),
            ("true", "Windows", "github-hosted", "1", "Windows", run.as_str(), "unknown"),
            ("true", "Windows", "github-hosted", "1", "Windows", run.as_str(), "unavailable"),
        ] { assert!(guard(ci, runner, hosted, opt, platform, id, phase).is_err()); }
        assert!(guard("true", "macOS", "github-hosted", "1", "macOS", &run, "unavailable").is_ok());
    }
}
