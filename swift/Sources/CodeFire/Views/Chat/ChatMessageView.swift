import SwiftUI

struct ChatMessageView: View {
    let message: ChatMessage
    let projectId: String?
    let onCreateTask: (String) -> Void
    let onAddToNotes: (String) -> Void
    let onSendToTerminal: (String) -> Void

    @State private var isHovering = false
    @State private var showCopied = false

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if message.role == "user" {
                Spacer(minLength: 60)
                userBubble
            } else {
                assistantBubble
                Spacer(minLength: 60)
            }
        }
    }

    // MARK: - User Bubble

    private var userBubble: some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(message.content)
                .font(.system(size: 12))
                .foregroundColor(.white)
                .textSelection(.enabled)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.accentColor)
                )

            Text(message.createdAt.formatted(.dateTime.hour().minute()))
                .font(.system(size: 9))
                .foregroundStyle(.quaternary)
        }
    }

    // MARK: - Assistant Bubble

    private var assistantBubble: some View {
        VStack(alignment: .leading, spacing: 4) {
            MarkdownContentView(content: message.content)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color(nsColor: .controlBackgroundColor).opacity(0.6))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color(nsColor: .separatorColor).opacity(0.25), lineWidth: 0.5)
                )

            // Action buttons — show on hover
            if isHovering {
                HStack(spacing: 2) {
                    actionButton("Create Task", icon: "checklist") {
                        onCreateTask(message.content)
                    }
                    actionButton("Add to Notes", icon: "note.text.badge.plus") {
                        onAddToNotes(message.content)
                    }
                    actionButton(showCopied ? "Copied!" : "Copy", icon: "doc.on.doc") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(message.content, forType: .string)
                        showCopied = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                            showCopied = false
                        }
                    }
                    actionButton("To Terminal", icon: "terminal") {
                        onSendToTerminal(message.content)
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }

            Text(message.createdAt.formatted(.dateTime.hour().minute()))
                .font(.system(size: 9))
                .foregroundStyle(.quaternary)
        }
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.15)) {
                isHovering = hovering
            }
        }
    }

    // MARK: - Action Button

    private func actionButton(_ label: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 3) {
                Image(systemName: icon)
                    .font(.system(size: 8))
                Text(label)
                    .font(.system(size: 9, weight: .medium))
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(nsColor: .controlBackgroundColor))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .foregroundColor(.secondary)
    }
}
