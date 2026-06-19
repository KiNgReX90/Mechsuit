// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Whether to force WebKitGTK's crisp (DMABUF-off) surface fallback.
///
/// Disabling WebKit's DMABUF renderer (`WEBKIT_DISABLE_DMABUF_RENDERER`) fixes a
/// blurry/pixelated surface on some Linux compositor+driver combos, but drops
/// WebKit onto a slow readback path that makes the whole UI sluggish — so it is
/// opt-in. Force it only when the user opted in (`MECHSUIT_CRISP_SURFACE`
/// present) AND has not already set `WEBKIT_DISABLE_DMABUF_RENDERER` themselves
/// (an explicit setting is honored as-is, never overridden).
fn should_force_crisp_surface(crisp_opt_in: bool, webkit_var_already_set: bool) -> bool {
    crisp_opt_in && !webkit_var_already_set
}

fn main() {
    // On Linux the webview is WebKitGTK; default to the fast GPU (DMABUF)
    // compositing path and only force the crisp/blurry fallback when the user
    // opts in via MECHSUIT_CRISP_SURFACE. Must run before GTK/WebKit initializes.
    #[cfg(target_os = "linux")]
    {
        let crisp_opt_in = std::env::var_os("MECHSUIT_CRISP_SURFACE").is_some();
        let webkit_var_already_set =
            std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some();
        if should_force_crisp_surface(crisp_opt_in, webkit_var_already_set) {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    mechsuit_lib::run()
}

#[cfg(test)]
mod tests {
    use super::should_force_crisp_surface;

    #[test]
    fn forces_crisp_only_when_opted_in_and_not_already_set() {
        // Opted in, user hasn't set the WebKit var: force the crisp fallback.
        assert!(should_force_crisp_surface(true, false));
        // Default (no opt-in): keep the fast GPU path, never force.
        assert!(!should_force_crisp_surface(false, false));
        // Opted in but the user already set the var: honor theirs, don't override.
        assert!(!should_force_crisp_surface(true, true));
        // No opt-in and already set: leave it untouched.
        assert!(!should_force_crisp_surface(false, true));
    }
}
