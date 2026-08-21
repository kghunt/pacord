import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownBody({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Open links in a new tab; keep them from breaking the layout.
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        // Prevent images from being rendered (not useful over packet radio and
        // could be used for tracking pixels).
        img: () => null,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
