import AppKit

/// NSTextView subclass used by the file viewer and editor. Adds:
///   - A "Create Task / Add to Notes / Send to Terminal" section at the top
///     of the contextual menu when the user has made a text selection.
///   - Cmd+F keybinding that opens the native incremental find bar.
final class FileTextView: NSTextView {

    var onCreateTask: ((String) -> Void)?
    var onAddToNotes: ((String) -> Void)?
    var onInsertIntoTerminal: ((String) -> Void)?

    // MARK: - Contextual menu

    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = super.menu(for: event) ?? NSMenu()

        guard let range = selectedRanges.first?.rangeValue, range.length > 0 else {
            return menu
        }
        let nsString = string as NSString
        guard range.location >= 0,
              range.location + range.length <= nsString.length else {
            return menu
        }
        let selected = nsString.substring(with: range)

        var items: [NSMenuItem] = []

        if onCreateTask != nil {
            let item = NSMenuItem(
                title: "Create Task from Selection",
                action: #selector(contextCreateTask(_:)),
                keyEquivalent: ""
            )
            item.target = self
            item.representedObject = selected
            item.image = NSImage(systemSymbolName: "checklist", accessibilityDescription: nil)
            items.append(item)
        }

        if onAddToNotes != nil {
            let item = NSMenuItem(
                title: "Add Selection to Notes",
                action: #selector(contextAddToNotes(_:)),
                keyEquivalent: ""
            )
            item.target = self
            item.representedObject = selected
            item.image = NSImage(systemSymbolName: "note.text.badge.plus", accessibilityDescription: nil)
            items.append(item)
        }

        if onInsertIntoTerminal != nil {
            let item = NSMenuItem(
                title: "Send Selection to Terminal",
                action: #selector(contextInsertIntoTerminal(_:)),
                keyEquivalent: ""
            )
            item.target = self
            item.representedObject = selected
            item.image = NSImage(systemSymbolName: "terminal", accessibilityDescription: nil)
            items.append(item)
        }

        if !items.isEmpty {
            items.append(NSMenuItem.separator())
            for (index, item) in items.enumerated() {
                menu.insertItem(item, at: index)
            }
        }

        return menu
    }

    @objc private func contextCreateTask(_ sender: NSMenuItem) {
        guard let text = sender.representedObject as? String else { return }
        onCreateTask?(text)
    }

    @objc private func contextAddToNotes(_ sender: NSMenuItem) {
        guard let text = sender.representedObject as? String else { return }
        onAddToNotes?(text)
    }

    @objc private func contextInsertIntoTerminal(_ sender: NSMenuItem) {
        guard let text = sender.representedObject as? String else { return }
        onInsertIntoTerminal?(text)
    }

    // MARK: - Cmd+F → show find bar

    override func keyDown(with event: NSEvent) {
        let isCommand = event.modifierFlags.contains(.command)
        let key = event.charactersIgnoringModifiers?.lowercased() ?? ""

        if isCommand && key == "f" {
            let item = NSMenuItem()
            item.tag = NSTextFinder.Action.showFindInterface.rawValue
            performTextFinderAction(item)
            return
        }

        super.keyDown(with: event)
    }
}
