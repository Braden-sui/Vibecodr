/**
 * Vibecodr Embed Script
 *
 * Usage:
 * <div class="vibecodr-embed" data-post-id="POST_ID"></div>
 * <script src="https://vibecodr.space/embed.js" async></script>
 *
 * Or programmatically:
 * VibecodrEmbed.create('POST_ID', document.getElementById('container'), { theme: 'dark' });
 */

(function() {
  'use strict';

  const EMBED_BASE_URL = 'https://vibecodr.space/e';

  /**
   * Create an embed iframe
   */
  function createEmbed(postId, container, options = {}) {
    const {
      width = '100%',
      height = '600px',
      theme = 'light',
      autoResize = true,
    } = options;

    // Create iframe
    const iframe = document.createElement('iframe');
    iframe.src = `${EMBED_BASE_URL}/${postId}${theme === 'dark' ? '?theme=dark' : ''}`;
    iframe.style.width = width;
    iframe.style.height = height;
    iframe.style.border = 'none';
    iframe.style.borderRadius = '8px';
    iframe.style.overflow = 'hidden';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
    iframe.setAttribute('allowfullscreen', 'true');

    // Auto-resize support
    if (autoResize && window.ResizeObserver) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === iframe) {
            // Adjust container height based on content
            const contentHeight = entry.contentRect.height;
            if (contentHeight > 0) {
              iframe.style.height = contentHeight + 'px';
            }
          }
        }
      });

      iframe.addEventListener('load', () => {
        resizeObserver.observe(iframe);
      });
    }

    // Clear container and append iframe
    container.innerHTML = '';
    container.appendChild(iframe);

    return iframe;
  }

  /**
   * Auto-discover and render embeds
   */
  function autoDiscoverEmbeds() {
    const embedElements = document.querySelectorAll('.vibecodr-embed:not([data-vibecodr-loaded])');

    embedElements.forEach((element) => {
      const postId = element.getAttribute('data-post-id');
      const width = element.getAttribute('data-width') || '100%';
      const height = element.getAttribute('data-height') || '600px';
      const theme = element.getAttribute('data-theme') || 'light';
      const autoResize = element.getAttribute('data-auto-resize') !== 'false';

      if (!postId) {
        console.error('Vibecodr Embed: Missing data-post-id attribute');
        return;
      }

      createEmbed(postId, element, {
        width,
        height,
        theme,
        autoResize,
      });

      element.setAttribute('data-vibecodr-loaded', 'true');
    });
  }

  // Expose API
  window.VibecodrEmbed = {
    create: createEmbed,
    discover: autoDiscoverEmbeds,
  };

  // Auto-discover on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoDiscoverEmbeds);
  } else {
    autoDiscoverEmbeds();
  }

  // Watch for new embeds (for SPAs)
  if (window.MutationObserver) {
    const observer = new MutationObserver((mutations) => {
      let shouldDiscover = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.classList && node.classList.contains('vibecodr-embed')) {
                shouldDiscover = true;
                break;
              }
              if (node.querySelector && node.querySelector('.vibecodr-embed')) {
                shouldDiscover = true;
                break;
              }
            }
          }
        }
        if (shouldDiscover) break;
      }

      if (shouldDiscover) {
        autoDiscoverEmbeds();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
})();
