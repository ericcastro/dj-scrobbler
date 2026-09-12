import AppKit
import AVFoundation
import AVKit

func emit(_ status: String, _ message: String? = nil) {
    var payload = ["status": status]
    if let message { payload["message"] = message }
    if let data = try? JSONSerialization.data(withJSONObject: payload),
       let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout)
    }
}

final class AirPlayDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, AVRoutePickerViewDelegate {
    private var player: AVPlayer?
    private var routePicker: AVRoutePickerView?
    private var window: NSWindow?
    private var externalPlaybackObservation: NSKeyValueObservation?
    private var wasExternal = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard CommandLine.arguments.count > 1,
              let url = URL(string: CommandLine.arguments[1]) else {
            emit("error", "A valid HLS URL is required.")
            NSApp.terminate(nil)
            return
        }

        let player = AVPlayer(url: url)
        player.allowsExternalPlayback = true
        self.player = player

        let panel = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 126),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        panel.title = "Send DJ Scrobbler to TV"
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        panel.level = .floating

        let content = NSView(frame: panel.contentView?.bounds ?? .zero)
        content.autoresizingMask = [.width, .height]
        panel.contentView = content

        let label = NSTextField(labelWithString: "Choose an AirPlay display")
        label.font = NSFont.systemFont(ofSize: 14, weight: .semibold)
        label.alignment = .center
        label.frame = NSRect(x: 24, y: 78, width: 312, height: 22)
        content.addSubview(label)

        let hint = NSTextField(labelWithString: "Your focus view and overlays will play as one video.")
        hint.font = NSFont.systemFont(ofSize: 11)
        hint.textColor = .secondaryLabelColor
        hint.alignment = .center
        hint.frame = NSRect(x: 18, y: 55, width: 324, height: 18)
        content.addSubview(hint)

        let picker = AVRoutePickerView(frame: NSRect(x: 158, y: 12, width: 44, height: 38))
        picker.player = player
        picker.delegate = self
        picker.isRoutePickerButtonBordered = true
        content.addSubview(picker)
        self.routePicker = picker
        self.window = panel

        externalPlaybackObservation = player.observe(\.isExternalPlaybackActive, options: [.initial, .new]) { [weak self] player, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                if player.isExternalPlaybackActive {
                    self.wasExternal = true
                    player.play()
                    self.window?.orderOut(nil)
                    emit("casting")
                } else if self.wasExternal {
                    emit("stopped")
                    NSApp.terminate(nil)
                }
            }
        }

        NSApp.setActivationPolicy(.accessory)
        NSApp.activate(ignoringOtherApps: true)
        panel.center()
        panel.makeKeyAndOrderFront(nil)
        emit("ready")

        // AVRoutePickerView owns the system routing UI. On current macOS its
        // control is an NSButton; opening it here turns the app's AirPlay action
        // directly into Apple's required picker. The small helper panel remains
        // visible as a fallback if Apple changes that private view hierarchy.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            self?.firstButton(in: picker)?.performClick(nil)
        }
    }

    private func firstButton(in view: NSView) -> NSButton? {
        if let button = view as? NSButton { return button }
        for child in view.subviews {
            if let button = firstButton(in: child) { return button }
        }
        return nil
    }

    func routePickerViewWillBeginPresentingRoutes(_ routePickerView: AVRoutePickerView) {
        emit("choosing")
    }

    func routePickerViewDidEndPresentingRoutes(_ routePickerView: AVRoutePickerView) {
        // Route activation can land a moment after Apple's menu closes. Give
        // AVPlayer that handoff window, then treat an unselected route as a
        // cancelled cast instead of leaving Electron stuck in "choosing".
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            guard let self, self.player?.isExternalPlaybackActive != true else { return }
            emit("stopped")
            NSApp.terminate(nil)
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        emit("stopped")
        NSApp.terminate(nil)
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        player?.pause()
        externalPlaybackObservation?.invalidate()
    }
}

let application = NSApplication.shared
let delegate = AirPlayDelegate()
application.delegate = delegate
application.run()
