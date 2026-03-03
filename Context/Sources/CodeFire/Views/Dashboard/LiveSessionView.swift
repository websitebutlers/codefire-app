import SwiftUI

/// Live mission-control view for an active Claude Code session.
///
/// Parses the session JSONL file in real-time (every 2s) and displays
/// token usage, cost, tools invoked, files touched, and an activity feed.
struct LiveSessionView: View {
    @EnvironmentObject var monitor: LiveSessionMonitor
    @State private var pulseAnimation = false
    @State private var detailsExpanded = false

    private var state: LiveSessionState { monitor.state }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                sessionHeader
                Divider()
                statsRow
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                Divider()
                detailsSection
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                activityFeed
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
            }
        }
    }

    // MARK: - Header

    private var sessionHeader: some View {
        HStack(spacing: 10) {
            // Pulsing live dot
            ZStack {
                Circle()
                    .fill(.green.opacity(0.3))
                    .frame(width: 18, height: 18)
                    .scaleEffect(pulseAnimation ? 1.8 : 1.0)
                    .opacity(pulseAnimation ? 0 : 0.6)
                Circle()
                    .fill(.green)
                    .frame(width: 8, height: 8)
            }
            .onAppear {
                withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: false)) {
                    pulseAnimation = true
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text("LIVE")
                        .font(.system(size: 10, weight: .black))
                        .tracking(1)
                        .foregroundColor(.green)

                    Text(state.slug ?? String(state.sessionId?.prefix(8) ?? ""))
                        .font(.system(size: 13, weight: .semibold))
                        .lineLimit(1)
                }

                HStack(spacing: 8) {
                    if let branch = state.gitBranch {
                        Label(branch, systemImage: "arrow.triangle.branch")
                            .font(.system(size: 10))
                            .foregroundColor(.purple.opacity(0.8))
                    }
                    if let model = state.model {
                        Text(shortModelName(model))
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(.blue.opacity(0.8))
                    }
                    Text(state.elapsedFormatted)
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color.green.opacity(0.04))
    }

    // MARK: - Stats Row

    private var statsRow: some View {
        HStack(spacing: 10) {
            // Context meter
            VStack(spacing: 6) {
                contextMeter
                    .frame(height: 6)

                HStack(spacing: 0) {
                    Text(state.contextFormatted)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                    Text(" / 200k")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundColor(.secondary)
                }

                Text("CodeFire")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(nsColor: .controlBackgroundColor).opacity(0.6))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
            )

            // Cost
            LiveStatCard(
                value: String(format: "$%.2f", state.estimatedCost),
                label: "Cost",
                icon: "dollarsign.circle",
                color: state.estimatedCost > 1 ? .orange : .green
            )

            // Messages
            LiveStatCard(
                value: "\(state.messageCount)",
                label: "Messages",
                icon: "message",
                color: .blue
            )

            // Tools
            LiveStatCard(
                value: "\(state.toolUseCount)",
                label: "Tools",
                icon: "wrench.and.screwdriver",
                color: .purple
            )
        }
    }

    private var contextMeter: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color(nsColor: .separatorColor).opacity(0.2))

                RoundedRectangle(cornerRadius: 3)
                    .fill(contextColor.opacity(0.7))
                    .frame(width: max(0, geo.size.width * state.contextUsagePercent))
                    .animation(.easeInOut(duration: 0.5), value: state.contextUsagePercent)
            }
        }
        .padding(.horizontal, 12)
    }

    private var contextColor: Color {
        if state.contextUsagePercent > 0.85 { return .red }
        if state.contextUsagePercent > 0.65 { return .orange }
        return .blue
    }

    // MARK: - Details (Tools + Files) — Collapsible

    private var detailsSection: some View {
        VStack(spacing: 0) {
            // Collapse toggle
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    detailsExpanded.toggle()
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: detailsExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(.secondary)
                        .frame(width: 10)
                    Text("Tool Usage & Files")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.secondary)
                    Spacer()
                    if !detailsExpanded {
                        Text("\(state.toolCounts.count) tools · \(state.filesChanged.count) files")
                            .font(.system(size: 10))
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if detailsExpanded {
                HStack(alignment: .top, spacing: 12) {
                    // Tool usage
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Tool Usage", systemImage: "wrench.and.screwdriver")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.secondary)

                        if state.toolCounts.isEmpty {
                            Text("No tools used yet")
                                .font(.system(size: 11))
                                .foregroundStyle(.tertiary)
                                .padding(.vertical, 4)
                        } else {
                            let maxCount = state.toolCounts.first?.count ?? 1
                            ForEach(state.toolCounts.prefix(8)) { tool in
                                ToolBar(name: tool.name, count: tool.count, maxCount: maxCount)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    // Files changed
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Files (\(state.filesChanged.count))", systemImage: "doc.text")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.secondary)

                        if state.filesChanged.isEmpty {
                            Text("No files touched yet")
                                .font(.system(size: 11))
                                .foregroundStyle(.tertiary)
                                .padding(.vertical, 4)
                        } else {
                            ForEach(state.filesChanged.suffix(10).reversed(), id: \.self) { path in
                                HStack(spacing: 4) {
                                    Image(systemName: "doc")
                                        .font(.system(size: 8))
                                        .foregroundStyle(.tertiary)
                                    Text((path as NSString).lastPathComponent)
                                        .font(.system(size: 11, design: .monospaced))
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                        .foregroundColor(.primary.opacity(0.8))
                                }
                            }
                            if state.filesChanged.count > 10 {
                                Text("+\(state.filesChanged.count - 10) more")
                                    .font(.system(size: 10))
                                    .foregroundStyle(.tertiary)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    // MARK: - Activity Feed

    private var activityFeed: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Activity", systemImage: "list.bullet")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.secondary)

            if state.recentActivity.isEmpty {
                Text("Waiting for activity...")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 4)
            } else {
                LazyVStack(spacing: 2) {
                    ForEach(state.recentActivity.prefix(20)) { item in
                        ActivityRow(item: item)
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    private func shortModelName(_ model: String) -> String {
        if model.contains("opus")   { return "Opus" }
        if model.contains("sonnet") { return "Sonnet" }
        if model.contains("haiku")  { return "Haiku" }
        return model
    }
}

// MARK: - Stat Card

struct LiveStatCard: View {
    let value: String
    let label: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(color.opacity(0.7))

            Text(value)
                .font(.system(size: 16, weight: .bold, design: .rounded))

            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.6))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
        )
    }
}

// MARK: - Tool Bar

struct ToolBar: View {
    let name: String
    let count: Int
    let maxCount: Int

    var body: some View {
        HStack(spacing: 6) {
            Text(name)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .frame(width: 50, alignment: .trailing)
                .lineLimit(1)
                .foregroundColor(.secondary)

            GeometryReader { geo in
                let ratio = maxCount > 0 ? CGFloat(count) / CGFloat(maxCount) : 0
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.purple.opacity(0.5))
                    .frame(width: max(4, geo.size.width * ratio))
            }
            .frame(height: 8)

            Text("\(count)")
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundColor(.primary.opacity(0.6))
                .frame(width: 20, alignment: .trailing)
        }
        .frame(height: 14)
    }
}

// MARK: - Activity Row

struct ActivityRow: View {
    let item: ActivityItem

    var body: some View {
        HStack(spacing: 6) {
            // Timestamp
            Text(item.timestamp.formatted(.dateTime.hour().minute()))
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .foregroundStyle(.tertiary)
                .frame(width: 38, alignment: .trailing)

            // Type indicator
            Circle()
                .fill(dotColor)
                .frame(width: 5, height: 5)

            // Detail
            Text(item.detail)
                .font(.system(size: 11))
                .foregroundColor(textColor)
                .lineLimit(1)
                .truncationMode(.tail)

            Spacer()
        }
        .padding(.vertical, 2)
        .padding(.horizontal, 4)
    }

    private var dotColor: Color {
        switch item.type {
        case .userMessage: return .blue
        case .assistantText: return .green
        case .toolUse: return .purple
        }
    }

    private var textColor: Color {
        switch item.type {
        case .userMessage: return .primary
        case .assistantText: return .primary.opacity(0.7)
        case .toolUse: return .secondary
        }
    }
}
