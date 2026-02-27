import SwiftUI
import AppKit

// MARK: - CodeEditorView (NSViewRepresentable)

struct CodeEditorView: NSViewRepresentable {
    @Binding var content: String
    let language: String?

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: NSViewRepresentableContext<CodeEditorView>) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = true
        scrollView.backgroundColor = NSColor.textBackgroundColor

        let textView = NSTextView()
        textView.isEditable = true
        textView.isSelectable = true
        textView.isRichText = false
        textView.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        textView.textColor = NSColor.labelColor
        textView.backgroundColor = NSColor.textBackgroundColor
        textView.autoresizingMask = [.width]
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = true
        textView.textContainer?.widthTracksTextView = false
        textView.textContainer?.containerSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )

        // Editing settings
        textView.allowsUndo = true
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextCompletionEnabled = false
        textView.smartInsertDeleteEnabled = false

        // Use spaces for tabs
        textView.isAutomaticLinkDetectionEnabled = false

        // Insertion point
        textView.insertionPointColor = NSColor.labelColor

        scrollView.documentView = textView

        // Line number ruler
        scrollView.hasVerticalRuler = true
        scrollView.rulersVisible = true
        let ruler = LineNumberRulerView(textView: textView)
        scrollView.verticalRulerView = ruler

        context.coordinator.textView = textView
        context.coordinator.rulerView = ruler
        textView.delegate = context.coordinator

        // Apply initial content with highlighting
        context.coordinator.applyHighlighting(content: content, language: language)

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: NSViewRepresentableContext<CodeEditorView>) {
        let coord = context.coordinator

        // Don't update if the user is actively editing (avoid fighting the user)
        guard !coord.isEditing else { return }

        if coord.lastContent != content || coord.lastLanguage != language {
            coord.applyHighlighting(content: content, language: language)
        }
    }

    // MARK: - Coordinator

    class Coordinator: NSObject, NSTextViewDelegate {
        var parent: CodeEditorView
        var textView: NSTextView?
        var rulerView: LineNumberRulerView?
        var lastContent: String?
        var lastLanguage: String?
        var isEditing = false
        private var highlightWorkItem: DispatchWorkItem?

        init(_ parent: CodeEditorView) {
            self.parent = parent
        }

        func applyHighlighting(content: String, language: String?) {
            guard let textView else { return }

            // Save selection
            let selectedRanges = textView.selectedRanges

            let highlighted = SyntaxHighlighter.highlight(content, language: language)
            textView.textStorage?.setAttributedString(highlighted)

            // Restore selection if valid
            let maxLen = (textView.string as NSString).length
            let restoredRanges = selectedRanges.compactMap { rangeValue -> NSValue? in
                let range = rangeValue.rangeValue
                if range.location <= maxLen {
                    let clampedLength = min(range.length, maxLen - range.location)
                    return NSValue(range: NSRange(location: range.location, length: clampedLength))
                }
                return nil
            }
            if !restoredRanges.isEmpty {
                textView.setSelectedRanges(restoredRanges, affinity: .downstream, stillSelecting: false)
            }

            lastContent = content
            lastLanguage = language
            rulerView?.needsDisplay = true
        }

        // MARK: - NSTextViewDelegate

        func textDidBeginEditing(_ notification: Notification) {
            isEditing = true
        }

        func textDidEndEditing(_ notification: Notification) {
            isEditing = false
        }

        func textDidChange(_ notification: Notification) {
            guard let textView else { return }
            let newText = textView.string

            // Update the binding
            parent.content = newText
            lastContent = newText

            // Debounced re-highlighting (300ms after last edit)
            highlightWorkItem?.cancel()
            let workItem = DispatchWorkItem { [weak self] in
                guard let self, let textView = self.textView else { return }
                DispatchQueue.main.async {
                    // Re-check that content hasn't changed since scheduling
                    guard textView.string == self.lastContent else { return }
                    self.isEditing = true
                    self.applyHighlighting(content: textView.string, language: self.parent.language)
                    self.isEditing = false
                }
            }
            highlightWorkItem = workItem
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: workItem)
        }
    }
}
