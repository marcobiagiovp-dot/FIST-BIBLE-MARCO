import { Injectable } from '@angular/core';
import { GoogleGenAI, Type } from '@google/genai';

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private ai: GoogleGenAI | null = null;

  constructor() {
    // API key is expected in environment variables
    if (process.env.API_KEY) {
      this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    } else {
      console.error("Google GenAI API_KEY not configured.");
    }
  }

  async findVerseForTheme(theme: string, bookNames: string[]): Promise<{ book: string; chapter: number; verse: number } | null> {
    if (!this.ai) {
      console.error("Gemini AI not initialized.");
      return null;
    }

    const validBookNames = bookNames.join(', ');

    const prompt = `Find a single Bible verse (King James Version) that best represents the theme "${theme}". Respond ONLY with a JSON object. The book name MUST exactly match one of the following names: ${validBookNames}.`;

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              book: {
                type: Type.STRING,
                description: `The name of the Bible book. Must be one of the following: ${validBookNames}`
              },
              chapter: {
                type: Type.INTEGER,
                description: 'The chapter number.'
              },
              verse: {
                type: Type.INTEGER,
                description: 'The verse number.'
              }
            },
            required: ['book', 'chapter', 'verse']
          },
          temperature: 0.5,
        }
      });
      
      const jsonStr = response.text.trim();
      const result = JSON.parse(jsonStr);

      if (result && result.book && result.chapter && result.verse) {
        return {
          book: result.book,
          chapter: result.chapter,
          verse: result.verse
        };
      }
      return null;

    } catch (error) {
      console.error(`Error fetching verse for theme "${theme}" with Gemini:`, error);
      throw new Error('Failed to communicate with the AI. Please try again later.');
    }
  }

  async generateChapterTitle(bookName: string, chapterNumber: number): Promise<string> {
    if (!this.ai) {
        return Promise.resolve(`${bookName} ${chapterNumber}`);
    }

    const prompt = `Generate a short, thematic title for ${bookName} chapter ${chapterNumber}. The title should summarize the main content or theme of the chapter, in the style of titles found in printed Bibles. Provide only the title, without any additional text or formatting.`;

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          temperature: 0.3,
          maxOutputTokens: 50,
        }
      });
      const title = response.text.trim();
      // Simple post-processing to remove potential quotes or markdown
      return title.replace(/["*]/g, '');
    } catch (error) {
      console.error('Error generating chapter title with Gemini:', error);
      // Returns a default title in case of error to not break the UI
      return `${bookName} ${chapterNumber}`;
    }
  }
}