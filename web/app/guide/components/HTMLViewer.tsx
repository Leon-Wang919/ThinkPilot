"use client";

import { useRef, useEffect } from "react";
import { Bug, Loader2 } from "lucide-react";
import { useKaTeXInjection } from "../hooks";
import { useTranslation } from "react-i18next";

interface HTMLViewerProps {
  html: string;
  currentIndex: number;
  loadingMessage: string;
  onOpenDebugModal: () => void;
}

const injectInteractionPolyfill = (html: string): string => {
  if (!html) return html;

  const polyfillStyle = `
  <style data-tp-interactive-polyfill>
    .graph { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 0.5rem; margin-top: 0.75rem; }
    .node { cursor: pointer; user-select: none; padding: 0.5rem 0.6rem; border: 1px solid #CBD5E1; border-radius: 0.5rem; background: #F8FAFC; transition: all 0.2s ease; text-align: center; }
    .node:hover { border-color: #3B82F6; background: #EFF6FF; }
    .node.active { border-color: #1D4ED8; background: #DBEAFE; color: #1E3A8A; font-weight: 600; }
  </style>`;

  const polyfillScript = `
  <script data-tp-interactive-polyfill>
    document.addEventListener('DOMContentLoaded', function() {
      var demoTitleRegex = /(标签切换示例|参数调节示例|图示演示|交互式演示|tab switch example|parameter control example|interactive demo)/i;
      var placeholderTokenRegex = /(标签1|标签2|标签3|内容1|内容2|内容3|节点1|节点2|Node 1|Node 2|Tab 1|Tab 2|Tab 3)/g;
      document.querySelectorAll('.card, section, article').forEach(function(block) {
        var titleEl = block.querySelector('.card-header, h1, h2, h3');
        if (!titleEl) return;
        var title = (titleEl.textContent || '').trim();
        if (!demoTitleRegex.test(title)) return;

        var wholeText = block.textContent || '';
        var hitCount = (wholeText.match(placeholderTokenRegex) || []).length;
        var hasConcreteVisual = !!block.querySelector('svg, canvas, img, table, .mermaid');

        if (!hasConcreteVisual && hitCount >= 3) {
          block.remove();
        }
      });

      document.querySelectorAll('.toggle-btn').forEach(function(btn) {
        if (btn.dataset.tpBound === '1') return;
        btn.dataset.tpBound = '1';
        btn.addEventListener('click', function() {
          var id = this.getAttribute('data-target');
          if (!id) return;
          var target = document.getElementById(id);
          if (!target) return;
          var hidden = target.classList.contains('hidden') || target.style.display === 'none';
          if (hidden) {
            target.classList.remove('hidden');
            target.style.display = 'block';
          } else {
            target.classList.add('hidden');
            target.style.display = 'none';
          }
        });
      });

      var tabButtons = document.querySelectorAll('.tab-btn');
      if (tabButtons.length > 0) {
        tabButtons.forEach(function(btn) {
          if (btn.dataset.tpBound === '1') return;
          btn.dataset.tpBound = '1';
          btn.addEventListener('click', function() {
            var id = this.getAttribute('data-target');
            if (!id) return;
            tabButtons.forEach(function(b) { b.classList.remove('active'); });
            document.querySelectorAll('.tab-content').forEach(function(c) {
              c.classList.remove('active');
              c.style.display = 'none';
            });
            this.classList.add('active');
            var target = document.getElementById(id);
            if (target) {
              target.classList.add('active');
              target.style.display = 'block';
            }
          });
        });
      }

      var nodes = Array.from(document.querySelectorAll('.node'));
      if (nodes.length > 0) {
        nodes.forEach(function(node, index) {
          if (!node.getAttribute('data-id')) {
            node.setAttribute('data-id', String(index + 1));
          }
          if (node.dataset.tpBound === '1') return;
          node.dataset.tpBound = '1';
          node.addEventListener('click', function() {
            nodes.forEach(function(n) { n.classList.remove('active'); });
            this.classList.add('active');

            var raw = this.getAttribute('data-adjacent') || '';
            if (!raw) return;
            raw.split(',').map(function(s) { return s.trim(); }).forEach(function(id) {
              if (!id) return;
              var byId = document.querySelector('.node[data-id="' + id + '"]');
              var idx = parseInt(id, 10);
              if (byId) {
                byId.classList.add('active');
              } else if (!isNaN(idx) && nodes[idx - 1]) {
                nodes[idx - 1].classList.add('active');
              }
            });
          });
        });
      }
    });
  </script>`;

  const hasPolyfill = html.includes('data-tp-interactive-polyfill');
  if (hasPolyfill) return html;

  let next = html;
  if (next.includes('</head>')) {
    next = next.replace('</head>', `${polyfillStyle}\n</head>`);
  } else {
    next = `${polyfillStyle}\n${next}`;
  }

  if (next.includes('</body>')) {
    next = next.replace('</body>', `${polyfillScript}\n</body>`);
  } else {
    next = `${next}\n${polyfillScript}`;
  }

  return next;
};

export default function HTMLViewer({
  html,
  currentIndex,
  loadingMessage,
  onOpenDebugModal,
}: HTMLViewerProps) {
  const { t } = useTranslation();
  const htmlFrameRef = useRef<HTMLIFrameElement>(null);
  const { injectKaTeX } = useKaTeXInjection();

  // Update HTML iframe
  useEffect(() => {
    if (!html) return;

    const timer = setTimeout(() => {
      if (htmlFrameRef.current) {
        const iframe = htmlFrameRef.current;
        console.log("Updating iframe with HTML, length:", html.length);

        // Inject KaTeX support if needed
        const htmlWithKaTeX = injectKaTeX(html);
        const htmlEnhanced = injectInteractionPolyfill(htmlWithKaTeX);

        // Use srcdoc attribute (most reliable method)
        try {
          iframe.srcdoc = htmlEnhanced;
          console.log("Iframe srcdoc set successfully with KaTeX support");
        } catch (e) {
          console.warn("srcdoc not supported, using contentDocument:", e);
          // Fallback to contentDocument if srcdoc not supported
          const handleLoad = () => {
            try {
              const doc =
                iframe.contentDocument || iframe.contentWindow?.document;
              if (doc) {
                doc.open();
                doc.write(htmlEnhanced);
                doc.close();
                console.log(
                  "Iframe content written via contentDocument with KaTeX support",
                );
              }
            } catch (err) {
              console.error("Failed to write to iframe:", err);
            }
          };

          if (
            iframe.contentDocument &&
            iframe.contentDocument.readyState === "complete"
          ) {
            handleLoad();
          } else {
            iframe.onload = handleLoad;
          }
        }
      } else {
        console.warn("htmlFrameRef.current is null");
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [html, currentIndex, injectKaTeX]);

  if (!html) {
    return (
      <div className="flex h-full w-full min-h-[520px] flex-col items-center justify-center">
        <Loader2 className="w-12 h-12 text-indigo-400 dark:text-indigo-500 animate-spin mb-4" />
        <p className="text-slate-500 dark:text-slate-400">
          {loadingMessage || t("Loading learning content...")}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full w-full min-h-[520px] bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden relative">
      {/* Debug Button */}
      <button
        onClick={onOpenDebugModal}
        className="absolute top-4 right-4 z-10 p-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors shadow-sm"
        title={t("Fix HTML")}
      >
        <Bug className="w-4 h-4 text-slate-600 dark:text-slate-300" />
      </button>

      {/* HTML Content */}
      <iframe
        ref={htmlFrameRef}
        className="w-full h-full border-0"
        title={t("Interactive Learning Content")}
        sandbox="allow-scripts allow-same-origin"
        key={`html-${currentIndex}-${html.length}`}
      />
    </div>
  );
}
