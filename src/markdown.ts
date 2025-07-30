/**
 * Converts a markdown link to an HTML link
 * @param text The markdown text containing links
 * @returns The text with markdown links converted to HTML links
 */
export function markdownToHtmlLink(text: string): string {
    // Regex to match markdown links [text](url)
    const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    
    // Replace markdown links with HTML links
    return text.replace(markdownLinkRegex, (_, linkText, url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
    });
}

export default {
    markdownToHtmlLink
}; 