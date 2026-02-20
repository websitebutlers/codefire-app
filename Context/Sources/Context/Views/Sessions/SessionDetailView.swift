import SwiftUI

struct SessionDetailView: View {
    let session: Session

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Header
                VStack(alignment: .leading, spacing: 8) {
                    Text(session.slug ?? session.id)
                        .font(.system(size: 16, weight: .bold))
                        .textSelection(.enabled)

                    HStack(spacing: 12) {
                        if let date = session.startedAt {
                            Label(date.formatted(.dateTime.month(.abbreviated).day().year().hour().minute()), systemImage: "calendar")
                                .font(.system(size: 12))
                                .foregroundColor(.secondary)
                        }
                        if let branch = session.gitBranch {
                            Label(branch, systemImage: "arrow.triangle.branch")
                                .font(.system(size: 12))
                                .foregroundColor(.secondary)
                        }
                        if let model = session.model {
                            Label(model, systemImage: "cpu")
                                .font(.system(size: 12))
                                .foregroundColor(.secondary)
                        }
                    }
                }

                Divider()

                // Stats row
                HStack(spacing: 20) {
                    DetailStat(icon: "message", label: "Messages", value: "\(session.messageCount)")
                    DetailStat(icon: "wrench", label: "Tool Uses", value: "\(session.toolUseCount)")
                    DetailStat(icon: "doc", label: "Files Changed", value: "\(session.filesChangedArray.count)")
                }

                // Summary section
                if let summary = session.summary, !summary.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Summary")
                            .font(.system(size: 13, weight: .semibold))
                        Text(summary)
                            .font(.system(size: 13))
                            .foregroundColor(.primary.opacity(0.85))
                            .textSelection(.enabled)
                    }
                }

                // Files changed
                let files = session.filesChangedArray
                if !files.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Files Changed (\(files.count))")
                            .font(.system(size: 13, weight: .semibold))

                        ForEach(files, id: \.self) { file in
                            HStack(spacing: 4) {
                                Image(systemName: "doc.text")
                                    .font(.system(size: 10))
                                    .foregroundColor(.secondary)
                                Text(file)
                                    .font(.system(size: 12, design: .monospaced))
                                    .lineLimit(1)
                                    .textSelection(.enabled)
                            }
                        }
                    }
                }

                // Resume button
                Button {
                    // Placeholder action
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "play.fill")
                            .font(.system(size: 11))
                        Text("Resume This Session")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.accentColor.opacity(0.15))
                    .foregroundColor(.accentColor)
                    .cornerRadius(6)
                }
                .buttonStyle(.plain)
                .padding(.top, 4)

                Spacer()
            }
            .padding(16)
        }
    }
}

// MARK: - Detail Stat

struct DetailStat: View {
    let icon: String
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: 2) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundColor(.accentColor)
            Text(value)
                .font(.system(size: 16, weight: .bold))
            Text(label)
                .font(.system(size: 10))
                .foregroundColor(.secondary)
        }
        .frame(width: 80, height: 60)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(6)
    }
}
