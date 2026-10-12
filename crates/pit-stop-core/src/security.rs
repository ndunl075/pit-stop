use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeDescriptor {
    pub port: u16,
    pub pid: u32,
    pub startup_id: String,
    pub token: String,
    #[serde(default = "default_inference")]
    pub infer_commands: bool,
}
impl std::fmt::Debug for RuntimeDescriptor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RuntimeDescriptor")
            .field("port", &self.port)
            .field("pid", &self.pid)
            .field("startup_id", &self.startup_id)
            .field("token", &"[redacted]")
            .field("infer_commands", &self.infer_commands)
            .finish()
    }
}
fn default_inference() -> bool {
    true
}
fn invalid() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "invalid_runtime_descriptor",
    )
}
impl RuntimeDescriptor {
    pub fn validate(&self) -> io::Result<()> {
        if self.port == 0
            || self.pid == 0
            || uuid::Uuid::parse_str(&self.startup_id).is_err()
            || !crate::event::opaque_key(&self.token)
        {
            return Err(invalid());
        }
        Ok(())
    }
}
pub fn data_dir() -> io::Result<PathBuf> {
    dirs::data_local_dir()
        .map(|p| p.join("Pit Stop"))
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "user_data_directory_unavailable"))
}
pub fn runtime_path() -> io::Result<PathBuf> {
    Ok(data_dir()?.join("runtime.json"))
}

pub fn read_runtime(path: &Path) -> io::Result<RuntimeDescriptor> {
    if fs::symlink_metadata(path)?.file_type().is_symlink() {
        return Err(invalid());
    }
    let file = File::open(path)?;
    if !file.metadata()?.is_file() || file.metadata()?.len() > 8192 {
        return Err(invalid());
    }
    platform::check(&file)?;
    let mut data = Vec::new();
    file.take(8193).read_to_end(&mut data)?;
    if data.len() > 8192 {
        return Err(invalid());
    }
    let value: RuntimeDescriptor = serde_json::from_slice(&data).map_err(|_| invalid())?;
    value.validate()?;
    Ok(value)
}

/// Token bytes are written only after applying an explicit current-user-only file ACL/mode.
pub fn write_runtime(path: &Path, runtime: &RuntimeDescriptor) -> io::Result<()> {
    runtime.validate()?;
    let parent = path.parent().ok_or_else(invalid)?;
    fs::create_dir_all(parent)?;
    let temp = parent.join(format!(".runtime-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).read(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            use windows_sys::Win32::{
                Foundation::{GENERIC_READ, GENERIC_WRITE},
                Storage::FileSystem::{READ_CONTROL, WRITE_DAC, WRITE_OWNER},
            };
            // Elevated tokens may default to Administrators as the file owner. Request
            // WRITE_OWNER so restrict can assign TokenUser before writing any secret.
            options
                .access_mode(GENERIC_READ | GENERIC_WRITE | READ_CONTROL | WRITE_DAC | WRITE_OWNER);
        }
        let mut file = options.open(&temp)?;
        platform::restrict(&file)?;
        platform::check(&file)?;
        file.write_all(&serde_json::to_vec(runtime).map_err(|_| invalid())?)?;
        file.sync_all()?;
        drop(file);
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            };
            let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
            let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            // SAFETY: both paths are NUL-terminated UTF-16 arrays alive for the call.
            if unsafe {
                MoveFileExW(
                    from.as_ptr(),
                    to.as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
        }
        #[cfg(not(windows))]
        fs::rename(&temp, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

pub fn remove_runtime(path: &Path, startup_id: &str) -> io::Result<()> {
    match read_runtime(path) {
        Ok(r) if r.startup_id == startup_id => fs::remove_file(path),
        Ok(_) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(unix)]
mod platform {
    use super::*;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    pub fn restrict(file: &File) -> io::Result<()> {
        file.set_permissions(fs::Permissions::from_mode(0o600))
    }
    pub fn check(file: &File) -> io::Result<()> {
        let m = file.metadata()?;
        // SAFETY: geteuid has no preconditions.
        if m.uid() != unsafe { libc::geteuid() } || m.mode() & 0o777 != 0o600 {
            Err(invalid())
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::{ffi::c_void, os::windows::io::AsRawHandle, ptr};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, LocalFree},
        Security::{Authorization::*, *},
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };

    // Windows owns token/SID and security descriptor allocations; guards free them on every path.
    struct Allocation(*mut c_void);
    impl Drop for Allocation {
        fn drop(&mut self) {
            unsafe {
                LocalFree(self.0);
            }
        }
    }
    fn user() -> io::Result<Vec<usize>> {
        unsafe {
            let mut token = ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut size = 0;
            GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut size);
            let mut data = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
            let success =
                GetTokenInformation(token, TokenUser, data.as_mut_ptr().cast(), size, &mut size);
            CloseHandle(token);
            if success == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(data)
        }
    }
    pub fn restrict(file: &File) -> io::Result<()> {
        unsafe {
            let current = user()?;
            let sid = (*(current.as_ptr() as *const TOKEN_USER)).User.Sid;
            let mut sid_string = ptr::null_mut();
            if ConvertSidToStringSidW(sid, &mut sid_string) == 0 {
                return Err(io::Error::last_os_error());
            }
            let sid_guard = Allocation(sid_string.cast());
            let mut len = 0;
            while *sid_string.add(len) != 0 {
                len += 1;
            }
            let sid_text = String::from_utf16_lossy(std::slice::from_raw_parts(sid_string, len));
            drop(sid_guard);
            let sddl: Vec<u16> = format!("D:P(A;;FA;;;{sid_text})")
                .encode_utf16()
                .chain(Some(0))
                .collect();
            let mut descriptor = ptr::null_mut();
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                ptr::null_mut(),
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }
            let _guard = Allocation(descriptor);
            let mut dacl = ptr::null_mut();
            let mut present = 0;
            let mut defaulted = 0;
            if GetSecurityDescriptorDacl(descriptor, &mut present, &mut dacl, &mut defaulted) == 0
                || present == 0
            {
                return Err(invalid());
            }
            let code = SetSecurityInfo(
                file.as_raw_handle(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION
                    | DACL_SECURITY_INFORMATION
                    | PROTECTED_DACL_SECURITY_INFORMATION,
                sid,
                ptr::null_mut(),
                dacl,
                ptr::null_mut(),
            );
            if code != 0 {
                return Err(io::Error::from_raw_os_error(code as i32));
            }
            Ok(())
        }
    }
    pub fn check(file: &File) -> io::Result<()> {
        unsafe {
            let current = user()?;
            let sid = (*(current.as_ptr() as *const TOKEN_USER)).User.Sid;
            let mut owner = ptr::null_mut();
            let mut dacl = ptr::null_mut();
            let mut descriptor = ptr::null_mut();
            let code = GetSecurityInfo(
                file.as_raw_handle(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                &mut owner,
                ptr::null_mut(),
                &mut dacl,
                ptr::null_mut(),
                &mut descriptor,
            );
            if code != 0 {
                return Err(io::Error::from_raw_os_error(code as i32));
            }
            let _guard = Allocation(descriptor);
            if owner.is_null()
                || EqualSid(owner, sid) == 0
                || dacl.is_null()
                || (*dacl).AceCount != 1
            {
                return Err(invalid());
            }
            let mut ace = ptr::null_mut();
            if GetAce(dacl, 0, &mut ace) == 0 {
                return Err(invalid());
            }
            let allowed = &*(ace as *const ACCESS_ALLOWED_ACE);
            // ACCESS_ALLOWED_ACE_TYPE is 0 in the Win32 ACE_HEADER contract.
            if allowed.Header.AceType != 0
                || EqualSid(ptr::addr_of!(allowed.SidStart) as *mut c_void, sid) == 0
            {
                return Err(invalid());
            }
            Ok(())
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::{
            Foundation::{GENERIC_READ, GENERIC_WRITE},
            Storage::FileSystem::{READ_CONTROL, WRITE_DAC, WRITE_OWNER},
        };

        #[test]
        fn restrict_replaces_token_default_owner_and_rejects_public_acl() {
            let directory = tempfile::tempdir().unwrap();
            let file = OpenOptions::new()
                .create_new(true)
                .read(true)
                .write(true)
                .access_mode(GENERIC_READ | GENERIC_WRITE | READ_CONTROL | WRITE_DAC | WRITE_OWNER)
                .open(directory.path().join("owner-regression.json"))
                .unwrap();
            // Reproduce the process token's default owner explicitly. This is the user's
            // SID on ordinary accounts, but Administrators on elevated Windows CI tokens.
            // A public DACL also proves restriction still rejects other principals.
            unsafe {
                let mut token = ptr::null_mut();
                assert_ne!(
                    OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token),
                    0
                );
                let mut size = 0;
                GetTokenInformation(token, TokenOwner, ptr::null_mut(), 0, &mut size);
                let mut owner =
                    vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
                let success = GetTokenInformation(
                    token,
                    TokenOwner,
                    owner.as_mut_ptr().cast(),
                    size,
                    &mut size,
                );
                CloseHandle(token);
                assert_ne!(success, 0);
                let default_owner = (*(owner.as_ptr() as *const TOKEN_OWNER)).Owner;
                let sddl: Vec<u16> = "D:P(A;;FA;;;WD)".encode_utf16().chain(Some(0)).collect();
                let mut descriptor = ptr::null_mut();
                assert_ne!(
                    ConvertStringSecurityDescriptorToSecurityDescriptorW(
                        sddl.as_ptr(),
                        1,
                        &mut descriptor,
                        ptr::null_mut()
                    ),
                    0
                );
                let _guard = Allocation(descriptor);
                let mut dacl = ptr::null_mut();
                let mut present = 0;
                let mut defaulted = 0;
                assert_ne!(
                    GetSecurityDescriptorDacl(descriptor, &mut present, &mut dacl, &mut defaulted),
                    0
                );
                assert_eq!(
                    SetSecurityInfo(
                        file.as_raw_handle(),
                        SE_FILE_OBJECT,
                        OWNER_SECURITY_INFORMATION
                            | DACL_SECURITY_INFORMATION
                            | PROTECTED_DACL_SECURITY_INFORMATION,
                        default_owner,
                        ptr::null_mut(),
                        dacl,
                        ptr::null_mut()
                    ),
                    0
                );
            }
            assert!(check(&file).is_err(), "a public DACL must remain invalid");
            restrict(&file).unwrap();
            check(&file).expect(
                "restriction must explicitly select TokenUser ownership and its sole allow ACE",
            );
        }
    }
}

#[cfg(not(any(unix, windows)))]
mod platform {
    use super::*;
    pub fn check(_: &File) -> io::Result<()> {
        Err(invalid())
    }
    pub fn restrict(_: &File) -> io::Result<()> {
        Err(invalid())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_roundtrip_and_ownership_cleanup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("runtime.json");
        let r = RuntimeDescriptor {
            port: 12345,
            pid: std::process::id(),
            startup_id: uuid::Uuid::new_v4().to_string(),
            token: "ab".repeat(32),
            infer_commands: true,
        };
        write_runtime(&path, &r).unwrap();
        assert_eq!(read_runtime(&path).unwrap().token, r.token);
        remove_runtime(&path, "different-startup").unwrap();
        assert!(path.exists());
        remove_runtime(&path, &r.startup_id).unwrap();
        assert!(!path.exists());
    }
    #[test]
    fn public_file_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("runtime.json");
        fs::write(&path, b"{}").unwrap();
        assert!(read_runtime(&path).is_err());
    }
}
