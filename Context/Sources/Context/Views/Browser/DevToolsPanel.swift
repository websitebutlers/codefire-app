import SwiftUI

struct DevToolsPanel: View {
    @ObservedObject var tab: BrowserTab
    @Binding var isVisible: Bool

    enum DevToolsTab: String, CaseIterable {
        case elements = "Elements"
        case styles = "Styles"
        case boxModel = "Box Model"
        case network = "Network"

        var icon: String {
            switch self {
            case .elements: return "chevron.left.forwardslash.chevron.right"
            case .styles: return "paintbrush"
            case .boxModel: return "rectangle.center.inset.filled"
            case .network: return "antenna.radiowaves.left.and.right"
            }
        }
    }

    @State private var selectedTab: DevToolsTab = .elements
    @State private var selectedRequestId: String?
    @State private var networkFilter: NetworkFilter = .all

    enum NetworkFilter: String, CaseIterable {
        case all = "All"
        case fetch = "Fetch"
        case xhr = "XHR"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header bar
            headerBar

            Divider()

            // Tab content
            Group {
                switch selectedTab {
                case .elements:
                    elementsTab
                case .styles:
                    stylesTab
                case .boxModel:
                    boxModelTab
                case .network:
                    networkTab
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // MARK: - Header Bar

    private var headerBar: some View {
        HStack(spacing: 6) {
            // Element picker toggle
            Button {
                if tab.isElementPickerActive {
                    tab.stopElementPicker()
                } else {
                    tab.startElementPicker()
                }
            } label: {
                Image(systemName: "cursorarrow.click.2")
                    .font(.system(size: 11, weight: .medium))
                    .frame(width: 26, height: 26)
                    .background(
                        RoundedRectangle(cornerRadius: 4)
                            .fill(tab.isElementPickerActive ? Color.accentColor.opacity(0.2) : Color.clear)
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundColor(tab.isElementPickerActive ? .accentColor : .primary)
            .help("Select an element to inspect")

            // Tab buttons
            ForEach(DevToolsTab.allCases, id: \.self) { devTab in
                Button {
                    selectedTab = devTab
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: devTab.icon)
                            .font(.system(size: 9))
                        Text(devTab.rawValue)
                            .font(.system(size: 11, weight: selectedTab == devTab ? .semibold : .regular))
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 4)
                            .fill(selectedTab == devTab
                                  ? Color(nsColor: .controlBackgroundColor)
                                  : Color.clear)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundColor(selectedTab == devTab ? .primary : .secondary)
            }

            Spacer()

            // Selected element label
            if let el = tab.inspectedElement {
                selectedElementLabel(el)
            }

            // Close button
            Button {
                tab.stopElementPicker()
                isVisible = false
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.tertiary)
                    .frame(width: 20, height: 20)
                    .background(
                        Circle()
                            .fill(Color(nsColor: .controlBackgroundColor).opacity(0.6))
                    )
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private func selectedElementLabel(_ el: InspectedElement) -> some View {
        HStack(spacing: 3) {
            Text("<\(el.tagName)>")
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)

            if let id = el.id, !id.isEmpty {
                Text("#\(id)")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.accentColor)
            }

            if !el.classes.isEmpty {
                Text(".\(el.classes.prefix(2).joined(separator: "."))")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.orange)
            }

            if let ref = el.axRef {
                Text("[\(ref)]")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
        }
        .lineLimit(1)
    }

    // MARK: - Elements Tab

    private var elementsTab: some View {
        Group {
            if let el = tab.inspectedElement {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        // Element tag display
                        elementTagDisplay(el)

                        Divider()

                        // Attributes
                        if !el.attributes.isEmpty {
                            sectionHeader("Attributes")
                            VStack(alignment: .leading, spacing: 2) {
                                ForEach(el.attributes.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                                    HStack(alignment: .top, spacing: 4) {
                                        Text(key)
                                            .font(.system(size: 11, design: .monospaced))
                                            .foregroundColor(.accentColor)
                                        Text("=")
                                            .font(.system(size: 11, design: .monospaced))
                                            .foregroundStyle(.tertiary)
                                        Text("\"\(value)\"")
                                            .font(.system(size: 11, design: .monospaced))
                                            .foregroundColor(.orange)
                                            .lineLimit(3)
                                            .textSelection(.enabled)
                                    }
                                }
                            }
                            .padding(.horizontal, 12)
                        }

                        // Position & Size
                        Divider()
                        sectionHeader("Position & Size")
                        HStack(spacing: 16) {
                            labeledValue("x", String(format: "%.0f", el.rect.x))
                            labeledValue("y", String(format: "%.0f", el.rect.y))
                            labeledValue("w", String(format: "%.0f", el.rect.width))
                            labeledValue("h", String(format: "%.0f", el.rect.height))
                        }
                        .padding(.horizontal, 12)

                        // Parent
                        if let parent = el.parent {
                            Divider()
                            sectionHeader("Parent")
                            elementSummaryRow(parent)
                                .padding(.horizontal, 12)
                        }

                        // Children
                        if !el.children.isEmpty {
                            Divider()
                            sectionHeader("Children (\(el.children.count))")
                            VStack(alignment: .leading, spacing: 2) {
                                ForEach(el.children) { child in
                                    elementSummaryRow(child)
                                }
                            }
                            .padding(.horizontal, 12)
                        }
                    }
                    .padding(.vertical, 8)
                }
            } else {
                emptyState(
                    icon: "cursorarrow.click.2",
                    message: "Click the picker button, then select an element on the page"
                )
            }
        }
    }

    @ViewBuilder
    private func elementTagDisplay(_ el: InspectedElement) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 0) {
                Text("<")
                    .foregroundStyle(.tertiary)
                Text(el.tagName)
                    .foregroundColor(.accentColor)

                if let id = el.id, !id.isEmpty {
                    Text(" id")
                        .foregroundColor(.orange)
                    Text("=\"\(id)\"")
                        .foregroundColor(.green)
                }

                if !el.classes.isEmpty {
                    Text(" class")
                        .foregroundColor(.orange)
                    Text("=\"\(el.classes.joined(separator: " "))\"")
                        .foregroundColor(.green)
                }

                Text(">")
                    .foregroundStyle(.tertiary)
            }
            .font(.system(size: 12, design: .monospaced))
            .textSelection(.enabled)

            // Selector
            HStack(spacing: 4) {
                Text("Selector:")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                Text(el.selector)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .textSelection(.enabled)
            }
        }
        .padding(.horizontal, 12)
    }

    @ViewBuilder
    private func elementSummaryRow(_ summary: ElementSummary) -> some View {
        HStack(spacing: 3) {
            Text("<\(summary.tagName)>")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.accentColor)

            if let id = summary.elementId, !id.isEmpty {
                Text("#\(id)")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.orange)
            }

            if !summary.classes.isEmpty {
                Text(".\(summary.classes.prefix(2).joined(separator: "."))")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
    }

    // MARK: - Styles Tab

    private var stylesTab: some View {
        Group {
            if let styles = tab.inspectedStyles {
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        stylesSection("Typography", styles.typography)
                        stylesSection("Layout", styles.layout)
                        stylesSection("Spacing", styles.spacing)
                        stylesSection("Colors", styles.colors)
                        stylesSection("Border", styles.border)
                        if !styles.other.isEmpty {
                            stylesSection("Other", styles.other)
                        }
                    }
                    .padding(.vertical, 8)
                }
            } else if tab.inspectedElement != nil {
                emptyState(
                    icon: "paintbrush",
                    message: "Loading styles..."
                )
            } else {
                emptyState(
                    icon: "paintbrush",
                    message: "Select an element to view its computed styles"
                )
            }
        }
    }

    @ViewBuilder
    private func stylesSection(_ title: String, _ pairs: [(String, String)]) -> some View {
        if !pairs.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                sectionHeader(title)

                ForEach(Array(pairs.enumerated()), id: \.offset) { _, pair in
                    HStack(alignment: .top, spacing: 0) {
                        Text(pair.0)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.accentColor)
                            .frame(minWidth: 160, alignment: .leading)
                        Text(pair.1)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.primary)
                            .lineLimit(2)
                            .textSelection(.enabled)
                    }
                    .padding(.horizontal, 12)
                }
            }

            Divider()
                .padding(.vertical, 2)
        }
    }

    // MARK: - Box Model Tab

    private var boxModelTab: some View {
        Group {
            if let box = tab.inspectedBoxModel {
                VStack(spacing: 0) {
                    Spacer()
                    boxModelDiagram(box)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else if tab.inspectedElement != nil {
                emptyState(
                    icon: "rectangle.center.inset.filled",
                    message: "Loading box model..."
                )
            } else {
                emptyState(
                    icon: "rectangle.center.inset.filled",
                    message: "Select an element to view its box model"
                )
            }
        }
    }

    @ViewBuilder
    private func boxModelDiagram(_ box: BoxModelData) -> some View {
        let marginColor = Color.orange.opacity(0.15)
        let borderColor = Color.yellow.opacity(0.2)
        let paddingColor = Color.green.opacity(0.15)
        let contentColor = Color.blue.opacity(0.15)

        ZStack {
            // Margin layer
            RoundedRectangle(cornerRadius: 4)
                .fill(marginColor)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(Color.orange.opacity(0.3), lineWidth: 1)
                )

            VStack(spacing: 0) {
                boxDimensionLabel(String(format: "%.0f", box.margin.top))
                    .foregroundColor(.orange)
                    .padding(.top, 4)

                HStack(spacing: 0) {
                    boxDimensionLabel(String(format: "%.0f", box.margin.left))
                        .foregroundColor(.orange)
                        .padding(.leading, 4)

                    // Border layer
                    ZStack {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(borderColor)
                            .overlay(
                                RoundedRectangle(cornerRadius: 3)
                                    .stroke(Color.yellow.opacity(0.4), lineWidth: 1)
                            )

                        VStack(spacing: 0) {
                            boxDimensionLabel(String(format: "%.0f", box.border.top))
                                .foregroundColor(.yellow)
                                .padding(.top, 3)

                            HStack(spacing: 0) {
                                boxDimensionLabel(String(format: "%.0f", box.border.left))
                                    .foregroundColor(.yellow)
                                    .padding(.leading, 3)

                                // Padding layer
                                ZStack {
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(paddingColor)
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 2)
                                                .stroke(Color.green.opacity(0.4), lineWidth: 1)
                                        )

                                    VStack(spacing: 0) {
                                        boxDimensionLabel(String(format: "%.0f", box.padding.top))
                                            .foregroundColor(.green)
                                            .padding(.top, 3)

                                        HStack(spacing: 0) {
                                            boxDimensionLabel(String(format: "%.0f", box.padding.left))
                                                .foregroundColor(.green)
                                                .padding(.leading, 3)

                                            // Content
                                            RoundedRectangle(cornerRadius: 2)
                                                .fill(contentColor)
                                                .overlay(
                                                    RoundedRectangle(cornerRadius: 2)
                                                        .stroke(Color.blue.opacity(0.3), lineWidth: 1)
                                                )
                                                .overlay(
                                                    Text("\(String(format: "%.0f", box.content.width)) x \(String(format: "%.0f", box.content.height))")
                                                        .font(.system(size: 10, design: .monospaced))
                                                        .foregroundColor(.blue)
                                                )
                                                .frame(minWidth: 80, minHeight: 36)

                                            boxDimensionLabel(String(format: "%.0f", box.padding.right))
                                                .foregroundColor(.green)
                                                .padding(.trailing, 3)
                                        }

                                        boxDimensionLabel(String(format: "%.0f", box.padding.bottom))
                                            .foregroundColor(.green)
                                            .padding(.bottom, 3)
                                    }
                                }
                                .padding(4)

                                boxDimensionLabel(String(format: "%.0f", box.border.right))
                                    .foregroundColor(.yellow)
                                    .padding(.trailing, 3)
                            }

                            boxDimensionLabel(String(format: "%.0f", box.border.bottom))
                                .foregroundColor(.yellow)
                                .padding(.bottom, 3)
                        }
                    }
                    .padding(4)

                    boxDimensionLabel(String(format: "%.0f", box.margin.right))
                        .foregroundColor(.orange)
                        .padding(.trailing, 4)
                }

                boxDimensionLabel(String(format: "%.0f", box.margin.bottom))
                    .foregroundColor(.orange)
                    .padding(.bottom, 4)
            }
        }
        .frame(maxWidth: 360, maxHeight: 200)

        // Legend
        HStack(spacing: 12) {
            legendItem("margin", .orange)
            legendItem("border", .yellow)
            legendItem("padding", .green)
            legendItem("content", .blue)
        }
        .padding(.top, 8)
    }

    private func boxDimensionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 9, design: .monospaced))
    }

    private func legendItem(_ label: String, _ color: Color) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2)
                .fill(color.opacity(0.3))
                .frame(width: 10, height: 10)
            Text(label)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Network Tab

    private var filteredRequests: [NetworkRequestEntry] {
        switch networkFilter {
        case .all: return tab.networkRequests
        case .fetch: return tab.networkRequests.filter { $0.type == .fetch }
        case .xhr: return tab.networkRequests.filter { $0.type == .xhr }
        }
    }

    private var networkTab: some View {
        VStack(spacing: 0) {
            // Toolbar row
            networkToolbar

            Divider()

            if let requestId = selectedRequestId,
               let request = tab.networkRequests.first(where: { $0.id == requestId }) {
                // Detail view
                networkDetailView(request)
            } else if filteredRequests.isEmpty {
                emptyState(
                    icon: "antenna.radiowaves.left.and.right",
                    message: tab.isNetworkMonitorActive
                        ? "No network requests captured"
                        : "Enable network monitoring to capture requests"
                )
            } else {
                // Request list
                networkRequestList
            }
        }
    }

    private var networkToolbar: some View {
        HStack(spacing: 6) {
            // Record toggle
            Button {
                if tab.isNetworkMonitorActive {
                    tab.stopNetworkMonitor()
                } else {
                    tab.startNetworkMonitor()
                }
            } label: {
                Image(systemName: "record.circle")
                    .font(.system(size: 11, weight: .medium))
                    .frame(width: 26, height: 26)
                    .background(
                        RoundedRectangle(cornerRadius: 4)
                            .fill(tab.isNetworkMonitorActive ? Color.red.opacity(0.2) : Color.clear)
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundColor(tab.isNetworkMonitorActive ? .red : .secondary)
            .help(tab.isNetworkMonitorActive ? "Stop monitoring" : "Start monitoring")

            // Clear button
            Button {
                tab.clearNetworkRequests()
                selectedRequestId = nil
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 10, weight: .medium))
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundColor(.secondary)
            .help("Clear requests")
            .disabled(tab.networkRequests.isEmpty)

            // Filter picker
            Picker("", selection: $networkFilter) {
                ForEach(NetworkFilter.allCases, id: \.self) { filter in
                    Text(filter.rawValue).tag(filter)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 140)

            Spacer()

            // Back button when viewing detail
            if selectedRequestId != nil {
                Button {
                    selectedRequestId = nil
                } label: {
                    HStack(spacing: 2) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 9, weight: .bold))
                        Text("Back")
                            .font(.system(size: 10))
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color(nsColor: .controlBackgroundColor))
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
            }

            // Request count
            Text("\(filteredRequests.count) request\(filteredRequests.count == 1 ? "" : "s")")
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
    }

    private var networkRequestList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(filteredRequests) { request in
                    networkRequestRow(request)
                        .onTapGesture {
                            selectedRequestId = request.id
                        }
                }
            }
        }
    }

    @ViewBuilder
    private func networkRequestRow(_ request: NetworkRequestEntry) -> some View {
        HStack(spacing: 6) {
            // Status badge
            Text(request.statusLabel)
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundColor(request.statusColor)
                .frame(width: 42, alignment: .trailing)

            // Method
            Text(request.method)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(.primary)
                .frame(width: 36, alignment: .leading)

            // Short URL
            Text(request.shortURL)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)

            Spacer()

            // Duration
            Text(request.formattedDuration)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.tertiary)
                .frame(width: 50, alignment: .trailing)

            // Size
            if !request.formattedSize.isEmpty {
                Text(request.formattedSize)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .frame(width: 50, alignment: .trailing)
            }

            // Type icon
            Image(systemName: request.type.icon)
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)
                .frame(width: 14)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(
            selectedRequestId == request.id
                ? Color.accentColor.opacity(0.1)
                : (request.isError ? Color.red.opacity(0.05) : Color.clear)
        )
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func networkDetailView(_ request: NetworkRequestEntry) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                // Full URL
                sectionHeader("URL")
                Text(request.url)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.primary)
                    .textSelection(.enabled)
                    .lineLimit(5)
                    .padding(.horizontal, 12)

                // General info
                Divider()
                sectionHeader("General")
                VStack(alignment: .leading, spacing: 2) {
                    networkDetailRow("Method", request.method)
                    networkDetailRow("Status", request.statusLabel)
                    networkDetailRow("Type", request.type.rawValue.uppercased())
                    networkDetailRow("Duration", request.formattedDuration)
                    if !request.formattedSize.isEmpty {
                        networkDetailRow("Size", request.formattedSize)
                    }
                }
                .padding(.horizontal, 12)

                // Request headers
                if let headers = request.requestHeaders, !headers.isEmpty {
                    Divider()
                    sectionHeader("Request Headers")
                    headersView(headers)
                }

                // Response headers
                if let headers = request.responseHeaders, !headers.isEmpty {
                    Divider()
                    sectionHeader("Response Headers")
                    headersView(headers)
                }

                // Response body preview
                if let body = request.responseBody, !body.isEmpty {
                    Divider()
                    sectionHeader("Response Body")
                    let preview = body.count > 2000 ? String(body.prefix(2000)) + "\n... (truncated)" : body
                    Text(preview)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .lineLimit(50)
                        .padding(.horizontal, 12)
                }
            }
            .padding(.vertical, 8)
        }
    }

    private func networkDetailRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 4) {
            Text(label)
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
                .frame(width: 60, alignment: .trailing)
            Text(value)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.primary)
                .textSelection(.enabled)
        }
    }

    @ViewBuilder
    private func headersView(_ headers: [String: String]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(headers.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                HStack(alignment: .top, spacing: 4) {
                    Text(key)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.accentColor)
                    Text(value)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .textSelection(.enabled)
                }
            }
        }
        .padding(.horizontal, 12)
    }

    // MARK: - Shared Components

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.tertiary)
            .textCase(.uppercase)
            .padding(.horizontal, 12)
            .padding(.top, 4)
    }

    private func labeledValue(_ label: String, _ value: String) -> some View {
        HStack(spacing: 3) {
            Text(label)
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }

    private func emptyState(icon: String, message: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundStyle(.tertiary)
            Text(message)
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
