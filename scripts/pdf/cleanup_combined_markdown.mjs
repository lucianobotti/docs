// Part of the PDF build: uses Remark to rewrite links, perform various other cleanup tasks to the combined markdown before rendering
// Usage: cleanup_combined_markdown.mjs <combined.md>
// requires original files to be demarcated with a HTML comment of the form, <span data-original-path='path_to_input.mdx'></span>

import path from "path";
import remarkParse from "remark-parse";
import mdx from "remark-mdx";
import unified from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkStringify from "remark-stringify";
import admonitions from "remark-admonitions";
import mdast2string from "mdast-util-to-string";
import GithubSlugger from "github-slugger";
import yaml from "js-yaml";
import { visitParents } from "unist-util-visit-parents";
import remarkMdxEmbeddedHast from "./lib/mdast-embedded-hast.mjs";
import toVfile from "to-vfile";
const { read, write } = toVfile;

(async () => {
  if (!process.argv[2]) {
    console.log(`usage:
  ${process.argv[1]} <combined.md>

example:
  ${process.argv[1]} "combined.mdx"`);
    return;
  }

  const processor = unified()
    .use(remarkParse)
    .use(remarkStringify, { emphasis: "*", bullet: "-", fences: true })
    .use(remarkMdxEmbeddedHast)
    .use(admonitions, {
      tag: "!!!",
      icons: "none",
      infima: true,
      customTypes: {
        seealso: "note",
        hint: "tip",
        interactive: "interactive",
      },
    })
    .use(mdx)
    .use(remarkFrontmatter)
    .use(cleanup);

  console.log("rewriting links and headings");
  const input = await read(process.argv[2]);
  let result = await processor.process(input);
  if (process.argv[3]) result.path = process.argv[3];

  write(result);
})();

function cleanup() {
  const originalRE = /<span data-original-path='(.+?)'><\/span>/;
  const docsUrl = "https://www.enterprisedb.com/docs";
  return (tree, file) => {
    const docsLocations = /product_docs\/docs|advocacy_docs/;
    const thisProductPath = path.dirname(file.path).split(docsLocations)[1];
    const thisUnversionedProductPath = thisProductPath.replace(
      /\/([^\/]+)\/[\d.]+/,
      "/$1/latest/",
    );

    const thisProductUrl = docsUrl + thisProductPath;
    const thisUnversionedProductUrl = docsUrl + thisUnversionedProductPath;
    const basePath = path.dirname(file.path).split(thisProductPath)[0];

    let mapOrigPathToSlugs = {};
    let currentOriginalPath = thisProductPath;
    let currentUnversionedOriginalPath = thisUnversionedProductPath;
    let currentSubpageSlug = "";
    let currentSubpageSlugger = new GithubSlugger();
    const slugger = new GithubSlugger();

    const getSlugForOrigPathAndSlug = (origPath, origSlug) => {
      const normalizedPath = origPath
        .replace(/\/?$/, "")
        .replace(/\.mdx?$/, "");

      const slugs =
        mapOrigPathToSlugs[normalizedPath] ||
        mapOrigPathToSlugs[normalizedPath + "/"] ||
        mapOrigPathToSlugs[normalizedPath.toLowerCase()] ||
        mapOrigPathToSlugs[normalizedPath.toLowerCase() + "/"];

      if (!slugs) {
        console.error("⚠️⚠️  cannot find topic for path: " + origPath);
        return "";
      }

      if (origSlug) {
        if (!slugs[origSlug])
          console.error(`⚠️  cannot find slug for ${origSlug} in ${origPath}`);
        return slugs[origSlug];
      }
      return Object.values(slugs)[0];
    };

    const normalizeUrl = (url) => {
      let dest = new URL(url, "local:" + currentOriginalPath);
      if (dest.protocol === "local:")
        dest = new URL(docsUrl + dest.pathname + dest.hash);
      return dest.toString();
    };

    const mapUrlToSlug = (url) => {
      if (
        url.startsWith(thisProductUrl) ||
        url.startsWith(thisUnversionedProductUrl)
      ) {
        const dest = new URL(url);
        const newSlug = getSlugForOrigPathAndSlug(
          dest.pathname.replace(/^\/docs/, ""),
          dest.hash.replace(/^#/, ""),
        );
        if (newSlug) return "#" + newSlug;
      }
      return url;
    };

    visitParents(
      tree,
      ["jsx-hast", "element", "link", "heading", "code", "admonition", "table"],
      (node, ancestors) => {
        if (node.type === "jsx-hast") {
          let originalPath = (node.value.match(originalRE) || [])[1];
          if (originalPath) {
            currentOriginalPath = originalPath
              .split(basePath)[1]
              .replace(/index\.mdx|\.mdx?/, "");
            currentUnversionedOriginalPath = currentOriginalPath.replace(
              /\/([^\/]+)\/[\d.]+\//,
              "/$1/latest/",
            );
            currentSubpageSlugger.reset();
            const siblings = ancestors[ancestors.length - 1].children;
            const idx = siblings.indexOf(node);
            siblings.splice(idx, 1);
            return idx;
          }
        }

        if (node.type === "heading") {
          const heading = mdast2string(node);
          const slug = slugger.slug(heading);
          const inPageSlug = currentSubpageSlugger.slug(heading);

          // bump all headings down a level
          node.depth++;

          if (node.depth === 2) currentSubpageSlug = slug;

          const slugMap =
            (mapOrigPathToSlugs[currentUnversionedOriginalPath] =
            mapOrigPathToSlugs[currentOriginalPath] =
              mapOrigPathToSlugs[currentOriginalPath] || {});
          slugMap[inPageSlug] = slug;

          const siblings = ancestors[ancestors.length - 1].children;
          const headingIdx = siblings.indexOf(node);
          siblings.splice(headingIdx, 0, {
            type: "jsx",
            value: `<div id='${slug}' data-original-path='${currentOriginalPath}'></div>`,
          });
          return headingIdx + 2;
        }

        // also capture any HTML with assigned IDs that may be used as link targets
        if (node.type === "element" && node.properties.id) {
          const slugMap =
            (mapOrigPathToSlugs[currentUnversionedOriginalPath] =
            mapOrigPathToSlugs[currentOriginalPath] =
              mapOrigPathToSlugs[currentOriginalPath] || {});
          node.properties.id = slugMap[node.properties.id] = slugger.slug(
            node.properties.id,
          );
        }

        if (
          node.type === "element" &&
          node.tagName === "a" &&
          node.properties.href
        ) {
          node.properties.href = normalizeUrl(node.properties.href);
        }
        if (node.type === "link") {
          node.url = normalizeUrl(node.url);
        }

        if (node.type === "code") {
          const {
            groups: { code, output },
          } = /^(?<code>.+)\n__OUTPUT__\n(?<output>.+)$/s.exec(node.value) || {
            groups: {},
          };

          if (code && output) {
            node.value = code;
            const siblings = ancestors[ancestors.length - 1].children;
            const idx = siblings.indexOf(node);
            siblings.splice(idx + 1, 0, { type: "code", value: output });
            return idx + 2;
          }
        }

        if (node.type === "admonition") {
          if (!node.children || !node.children.length) return;

          let heading = node.children.find(
            (n) => n.type === "admonition-heading",
          );
          let content = node.children.find(
            (n) => n.type === "admonition-content",
          );
          const keyword = node.keyword.toLowerCase();

          // nothing to process (incomplete)
          if (!heading || !keyword) return;

          // if this has already been transformed, un-transform for stringify
          if (
            heading.children.length &&
            heading.children[0].data &&
            heading.children[0].children &&
            heading.children[0].data.hName === "h5"
          ) {
            heading.children = heading.children[0].children.filter(
              (n) => n.type !== "admonition-icon",
            );
          }

          Object.assign(node, {
            type: "blockquote",
            children: [
              {
                type: "strong",
                children: heading.children.length
                  ? heading.children
                  : [
                      {
                        type: "text",
                        value:
                          keyword.charAt(0).toUpperCase() + keyword.slice(1),
                      },
                    ],
              },
              ...content.children,
            ],
          });
        }

        // pandoc is very sensitive to tables being separated from surrounding content
        // this can be removed once we're no longer using pandoc to render markdown->HTML
        if (node.type ==="table")
        {
          const siblings = ancestors[ancestors.length - 1].children;
          const idx = siblings.indexOf(node);
          siblings.splice(idx, 1, {type: "break"}, node, {type:"break"});
          return idx + 3;
        }
      },
    );

    visitParents(tree, ["link", "element"], (node) => {
      if (
        node.type === "element" &&
        node.tagName === "a" &&
        node.properties.href
      )
        node.properties.href = mapUrlToSlug(node.properties.href);
      else if (node.type === "link") node.url = mapUrlToSlug(node.url);
    });
  };
}
