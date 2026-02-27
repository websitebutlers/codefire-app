import Foundation

// MARK: - Inspected Element

struct InspectedElement {
    let selector: String
    let tagName: String
    let id: String?
    let classes: [String]
    let attributes: [String: String]
    let axRef: String?
    let rect: ElementRect
    let children: [ElementSummary]
    let parent: ElementSummary?
}

// MARK: - Element Summary

struct ElementSummary: Identifiable {
    let id = UUID()
    let tagName: String
    let elementId: String?
    let classes: [String]
    let selector: String
}

// MARK: - Element Rect

struct ElementRect {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

// MARK: - Computed Styles

struct ComputedStyles {
    let typography: [(String, String)]
    let layout: [(String, String)]
    let spacing: [(String, String)]
    let colors: [(String, String)]
    let border: [(String, String)]
    let other: [(String, String)]
}

// MARK: - Box Model Data

struct BoxModelData {
    let content: (width: Double, height: Double)
    let padding: (top: Double, right: Double, bottom: Double, left: Double)
    let border: (top: Double, right: Double, bottom: Double, left: Double)
    let margin: (top: Double, right: Double, bottom: Double, left: Double)
}
