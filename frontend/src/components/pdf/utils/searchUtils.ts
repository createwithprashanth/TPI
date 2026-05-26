// src/components/pdf/utils/searchUtils.ts

import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import type { PageViewport } from "pdfjs-dist";

export interface SearchMatch {
  page: number;
  index: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Search for text in PDF text content
 */
export async function searchInPdf(
  pdfDoc: any,
  searchTerm: string,
  numPages: number
): Promise<SearchMatch[]> {
  if (!searchTerm.trim()) {
    return [];
  }

  const matches: SearchMatch[] = [];
  const searchLower = searchTerm.toLowerCase();

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent() as TextContent;
      const viewport = page.getViewport({ scale: 1 });

      const items = textContent.items.filter(
        (item): item is TextItem => "str" in item && "transform" in item
      );

      // Find matches in text items and store with their exact transform information
      items.forEach((item) => {
        if (!item.str) return;

        const transform = item.transform;
        const [a, , , d, e, f] = transform;
        const fontSize = Math.abs(d);
        const horizontalScale = Math.abs(a);
        
        // Calculate average character width for this text item
        // The transform matrix 'a' value represents horizontal character spacing/width
        // For most fonts:
        // - If 'a' is close to 'd' (font size), it's likely a monospace font
        // - If 'a' is smaller than 'd', it's a proportional font
        // We'll use 'a' directly if it's reasonable, otherwise estimate
        let charWidth: number;
        if (horizontalScale > 0.1) {
          // Use the horizontal scale directly
          charWidth = horizontalScale;
        } else {
          // Estimate: for proportional fonts, average character width is typically 50-60% of font size
          // For common fonts like Arial, Times, etc., it's around 0.55-0.6
          charWidth = fontSize * 0.6;
        }

        const text = item.str;
        const textLower = text.toLowerCase();
        let searchIndex = 0;

        // Find all occurrences in this text item
        while ((searchIndex = textLower.indexOf(searchLower, searchIndex)) !== -1) {
          // Calculate the position of the match within the text item
          // e is the x position of the start of the text item in PDF coordinates
          // We calculate the character offset to find where the match starts
          const matchStartX = e + (searchIndex * charWidth);
          const matchEndX = e + ((searchIndex + searchTerm.length) * charWidth);
          
          // Store PDF coordinates (will be transformed when rendering)
          matches.push({
            page: pageNum,
            index: matches.length,
            text: text.substring(searchIndex, searchIndex + searchTerm.length),
            x: matchStartX, // PDF x coordinate (start of match)
            y: f, // PDF y coordinate (baseline of text)
            width: Math.max(matchEndX - matchStartX, charWidth * 0.5), // PDF width of the match
            height: fontSize, // PDF height (font size)
          });

          searchIndex += searchTerm.length;
        }
      });
    } catch (error) {
      console.error(`Error searching page ${pageNum}:`, error);
    }
  }

  return matches;
}

/**
 * Search for text in a single page's text content
 */
export function searchInTextContent(
  textContent: TextContent,
  searchTerm: string,
  pageNum: number,
  viewport: PageViewport,
  scale: number
): SearchMatch[] {
  if (!searchTerm.trim()) {
    return [];
  }

  const matches: SearchMatch[] = [];
  const searchLower = searchTerm.toLowerCase();

  const items = textContent.items.filter(
    (item): item is TextItem => "str" in item && "transform" in item
  );

  items.forEach((item) => {
    if (!item.str) return;

    const text = item.str;
    const textLower = text.toLowerCase();
    let searchIndex = 0;

    // Find all occurrences in this text item
    while ((searchIndex = textLower.indexOf(searchLower, searchIndex)) !== -1) {
      // Calculate position and dimensions
      const [, , , d, e, f] = item.transform;
      const fontSize = Math.abs(d) * scale;
      const charWidth = fontSize * 0.6; // Approximate character width
      
      // Calculate the position of the match within the text
      const matchStartX = (e * scale) + (searchIndex * charWidth);
      const matchEndX = (e * scale) + ((searchIndex + searchTerm.length) * charWidth);
      
      // Convert PDF coordinates to viewport coordinates
      const x = matchStartX;
      const y = viewport.height - (f * scale); // Flip Y coordinate
      const width = (matchEndX - matchStartX);
      const height = fontSize;

      matches.push({
        page: pageNum,
        index: matches.length,
        text: text.substring(searchIndex, searchIndex + searchTerm.length),
        x,
        y,
        width,
        height,
      });

      searchIndex += searchTerm.length;
    }
  });

  return matches;
}

/**
 * Find text in PDF and return matches grouped by page in the new format
 * Returns: Array<{ page: number; rect: Array<{ x, y, width, height }> }>
 */
export async function findInPdf(
  pdfDoc: any,
  searchTerm: string,
  numPages: number
): Promise<Array<{ page: number; rect: Array<{ x: number; y: number; width: number; height: number }> }>> {
  if (!searchTerm.trim()) {
    return [];
  }

  const matchesByPage: Map<number, Array<{ x: number; y: number; width: number; height: number }>> = new Map();
  const searchLower = searchTerm.toLowerCase();

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent() as TextContent;
      const viewport = page.getViewport({ scale: 1 });

      const items = textContent.items.filter(
        (item): item is TextItem => "str" in item && "transform" in item
      );

      const pageRects: Array<{ x: number; y: number; width: number; height: number }> = [];

      // Find matches in text items and store with their exact transform information
      items.forEach((item) => {
        if (!item.str) return;

        const transform = item.transform;
        const [a, , , d, e, f] = transform;
        const fontSize = Math.abs(d);
        const horizontalScale = Math.abs(a);
        
        const text = item.str;
        const textLower = text.toLowerCase();
        
        // Calculate the total width of the text item
        // The transform matrix 'a' represents horizontal scaling
        // For proportional fonts, we need to estimate the width more accurately
        let textItemWidth: number;
        if (horizontalScale > 0.1 && text.length > 0) {
          // If we have horizontal scale, use it to estimate width
          // For proportional fonts, average character width varies
          // We'll calculate based on the actual text length and scale
          const avgCharWidth = horizontalScale;
          textItemWidth = text.length * avgCharWidth;
        } else {
          // Fallback: estimate based on font size
          // Average character width in proportional fonts is typically 50-60% of font size
          textItemWidth = text.length * fontSize * 0.55;
        }

        let searchIndex = 0;

        // Find all occurrences in this text item
        while ((searchIndex = textLower.indexOf(searchLower, searchIndex)) !== -1) {
          // Calculate the position of the match within the text item more accurately
          // e is the x position of the start of the text item in PDF coordinates
          
          // Calculate the width of the substring before the match
          const beforeMatch = text.substring(0, searchIndex);
          const matchSubstring = text.substring(searchIndex, searchIndex + searchTerm.length);
          
          // Calculate widths more accurately
          // The key insight: we need to calculate the width of the actual substring
          // not just multiply by a fixed character width
          let beforeMatchWidth: number;
          let matchWidth: number;
          
          // Character width multipliers for proportional fonts (relative to font size)
          const getCharWidthMultiplier = (char: string): number => {
            // Narrow characters
            if ('il|1!'.includes(char)) return 0.25;
            if ('tfjIJLTF'.includes(char)) return 0.35;
            if ('rsz'.includes(char)) return 0.45;
            // Average width characters (default)
            if ('aceghnopquvxyABCDEGHKNOPQRSUVXYZ234567890'.includes(char)) return 0.55;
            // Wide characters
            if ('mwMW@%'.includes(char)) return 0.85;
            // Spaces and punctuation
            if (char === ' ') return 0.3;
            if ('.:,;'.includes(char)) return 0.25;
            // Default for other characters
            return 0.55;
          };
          
          if (horizontalScale > 0.1) {
            // Use horizontal scale with character-specific adjustments
            const baseCharWidth = horizontalScale;
            beforeMatchWidth = Array.from(beforeMatch).reduce<number>((sum, char) => 
              sum + baseCharWidth * getCharWidthMultiplier(char), 0
            );
            matchWidth = Array.from(matchSubstring).reduce<number>((sum, char) => 
              sum + baseCharWidth * getCharWidthMultiplier(char), 0
            );
          } else {
            // Use font-size based estimation with character-specific adjustments
            beforeMatchWidth = Array.from(beforeMatch).reduce<number>((sum, char) => 
              sum + getCharWidthMultiplier(char) * fontSize, 0
            );
            matchWidth = Array.from(matchSubstring).reduce<number>((sum, char) => 
              sum + getCharWidthMultiplier(char) * fontSize, 0
            );
          }
          
          // Ensure minimum width to avoid invisible highlights
          matchWidth = Math.max(matchWidth, fontSize * 0.3);
          
          const matchStartX = e + beforeMatchWidth;
          const matchEndX = matchStartX + matchWidth;
          
          // Store PDF coordinates (will be transformed when rendering)
          // Note: y coordinate is the baseline, we need to adjust for the rect
          // The rect should start at the baseline and go up by font size
          // For better accuracy, we use the calculated match width directly
          pageRects.push({
            x: matchStartX, // PDF x coordinate (start of match)
            y: f, // PDF y coordinate (baseline of text)
            width: matchWidth, // PDF width of the match (calculated per character)
            height: fontSize, // PDF height (font size)
          });

          searchIndex += searchTerm.length;
        }
      });

      if (pageRects.length > 0) {
        matchesByPage.set(pageNum, pageRects);
      }
    } catch (error) {
      console.error(`Error searching page ${pageNum}:`, error);
    }
  }

  // Convert map to array format
  const result: Array<{ page: number; rect: Array<{ x: number; y: number; width: number; height: number }> }> = [];
  matchesByPage.forEach((rects, page) => {
    result.push({ page, rect: rects });
  });

  // Sort by page number
  result.sort((a, b) => a.page - b.page);

  return result;
}
