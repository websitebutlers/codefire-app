import SwiftUI

struct FileTreeRowView: View {
    let node: FileTreeNode
    let isSelected: Bool

    @State private var isHovering = false

    var body: some View {
        HStack(spacing: 4) {
            // Chevron for directories
            if node.isDirectory {
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(.secondary)
                    .rotationEffect(.degrees(node.isExpanded ? 90 : 0))
                    .frame(width: 12, height: 12)
            } else {
                Spacer().frame(width: 12)
            }

            // File/folder icon
            fileIcon
                .font(.system(size: 12))
                .frame(width: 16)

            // Filename
            Text(node.name)
                .font(.system(size: 12, weight: node.isDirectory ? .medium : .regular))
                .lineLimit(1)
                .truncationMode(.middle)

            Spacer()
        }
        .padding(.leading, CGFloat(node.depth) * 16)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: 5)
                .fill(isSelected
                      ? Color.accentColor.opacity(0.15)
                      : isHovering ? Color(nsColor: .separatorColor).opacity(0.15) : Color.clear)
        )
        .contentShape(Rectangle())
        .onHover { hovering in
            isHovering = hovering
        }
    }

    // MARK: - File Icon

    @ViewBuilder
    private var fileIcon: some View {
        if node.isDirectory {
            Image(systemName: node.isExpanded ? "folder.fill" : "folder")
                .foregroundColor(.accentColor)
        } else {
            let ext = (node.name as NSString).pathExtension.lowercased()
            switch ext {
            case "swift":
                Image(systemName: "swift")
                    .foregroundColor(.orange)
            case "js", "jsx", "ts", "tsx":
                Image(systemName: "doc.text")
                    .foregroundColor(.yellow)
            case "py":
                Image(systemName: "doc.text")
                    .foregroundColor(.blue)
            case "json", "yaml", "yml", "toml":
                Image(systemName: "gearshape")
                    .foregroundColor(.gray)
            case "md", "markdown":
                Image(systemName: "doc.richtext")
                    .foregroundColor(.secondary)
            case "html", "htm", "css":
                Image(systemName: "globe")
                    .foregroundColor(.purple)
            default:
                Image(systemName: "doc.text")
                    .foregroundColor(.secondary)
            }
        }
    }
}
