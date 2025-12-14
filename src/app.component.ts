import { Component, OnInit, ChangeDetectionStrategy, signal, inject, computed, WritableSignal, effect, ViewChild, ElementRef } from '@angular/core';
import { BibleService, ChapterContent, Verse } from './services/bible.service';
import { Book } from './models/book.model';
import { CoverComponent } from './cover/cover.component';
import { BIBLE_PREAMBLES } from './bible-preambles';
import { BIBLE_INTRA_CHAPTER_TITLES } from './bible-intra-chapter-titles';
import { GeminiService } from './services/gemini.service';
import { firstValueFrom } from 'rxjs';

const HighlightColors = ['yellow', 'green', 'red', 'purple'] as const;
type HighlightColor = (typeof HighlightColors)[number];

// Types for rendering mixed content (titles and verses)
interface TitleItem {
  type: 'title';
  text: string;
}
interface VerseItem {
  type: 'verse';
  data: Verse;
}
type ChapterDisplayItem = TitleItem | VerseItem;

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CoverComponent],
  host: {
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class AppComponent implements OnInit {
  private bibleService = inject(BibleService);
  private geminiService = inject(GeminiService);
  @ViewChild('contextMenuElement') contextMenuElement?: ElementRef<HTMLDivElement>;

  private readonly LAST_READ_KEY = 'bible-last-read';
  lastRead = signal<{ book: string; chapter: number; verse: number } | null>(null);

  isCoverVisible = signal(true);
  isDiscoveryVisible = signal(false);
  isFocusedVerseVisible = signal(false);
  isDiscoverLoading = signal(false);
  discoverError = signal<string | null>(null);
  
  focusedVerse = signal<{ reference: string; text: string; } | null>(null);
  currentDiscoveryTheme = signal<string | null>(null);

  isAppClosed = signal(false);

  books: WritableSignal<Book[]> = signal([]);
  selectedBook: WritableSignal<Book | null> = signal(null);
  selectedChapter: WritableSignal<number | null> = signal(null);
  chapterContent: WritableSignal<ChapterContent | null> = signal(null);
  isLoading = signal(false);
  error = signal<string | null>(null);

  // Preamble state
  chapterPreamble = signal<string | null>(null);

  // Font size state
  readonly initialFontSize = 1.125; // 18px, text-lg
  readonly minFontSize = 0.875; // 14px, text-sm
  readonly maxFontSize = 2.25; // 36px, text-4xl
  private readonly fontSizeStep = 0.125;
  fontSize = signal(this.initialFontSize);
  fontSizePercentage = computed(() => Math.round((this.fontSize() / this.initialFontSize) * 100));

  // Notes state
  notes = signal<string>('');
  saveStatus = signal<'idle' | 'saving' | 'saved'>('idle');
  private notesSaveTimeout?: ReturnType<typeof setTimeout>;

  // Theme state
  isDarkMode = signal<boolean>(false);

  // Highlight state
  verseHighlights = signal<Record<number, HighlightColor | null>>({});
  readonly highlightColors = HighlightColors;

  // Context Menu state
  contextMenu = signal({ visible: false, x: 0, y: 0, verse: null as number | null });

  // Share state
  shareStatus = signal<'idle' | 'copied'>('idle');

  displayItems = computed((): ChapterDisplayItem[] => {
    const content = this.chapterContent();
    const book = this.selectedBook();
    const chapter = this.selectedChapter();

    if (!content || !book || !chapter) {
      return [];
    }

    const items: ChapterDisplayItem[] = [];
    for (const verse of content.verses) {
      const key = `${book.name}-${chapter}-${verse.verse}`;
      const title = BIBLE_INTRA_CHAPTER_TITLES[key];
      if (title) {
        items.push({ type: 'title', text: title });
      }
      items.push({ type: 'verse', data: verse });
    }
    return items;
  });

  notesKey = computed(() => {
    const book = this.selectedBook();
    const chapter = this.selectedChapter();
    if (book && chapter) {
      return `bible-notes-${book.name}-${chapter}`;
    }
    return null;
  });

  oldTestamentBooks = computed(() => this.books().filter(b => b.testament === 'Old'));
  newTestamentBooks = computed(() => this.books().filter(b => b.testament === 'New'));

  chaptersForSelectedBook = computed(() => {
    const book = this.selectedBook();
    if (!book) return [];
    return Array.from({ length: book.chapters }, (_, i) => i + 1);
  });

  versesForSelectedChapter = computed(() => {
    const content = this.chapterContent();
    if (!content?.verses) return [];
    return content.verses.map(v => v.verse);
  });

  constructor() {
    // Last read location initialization
    const savedLocation = localStorage.getItem(this.LAST_READ_KEY);
    if (savedLocation) {
      try {
        this.lastRead.set(JSON.parse(savedLocation));
      } catch (e) {
        console.error("Error parsing last read location from localStorage", e);
        localStorage.removeItem(this.LAST_READ_KEY);
      }
    }

    // Theme initialization
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme) {
      this.isDarkMode.set(savedTheme === 'dark');
    } else {
      this.isDarkMode.set(prefersDark);
    }

    // Effect to apply theme class and save preference
    effect(() => {
      if (this.isDarkMode()) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
      }
    });
  }

  ngOnInit(): void {
    this.books.set(this.bibleService.getBooks());
  }

  hideCover(): void {
    this.isCoverVisible.set(false);
  }
  
  showDiscovery(): void {
    this.isCoverVisible.set(false);
    this.isDiscoveryVisible.set(true);
    this.discoverError.set(null);
  }

  async discoverTheme(theme: string): Promise<void> {
    this.currentDiscoveryTheme.set(theme);
    await this.fetchVerseForTheme(theme);
  }

  async findAnotherVerse(): Promise<void> {
    const theme = this.currentDiscoveryTheme();
    if (theme) {
        await this.fetchVerseForTheme(theme);
    }
  }

  private async fetchVerseForTheme(theme: string): Promise<void> {
    this.isDiscoverLoading.set(true);
    this.discoverError.set(null);

    if (!this.isFocusedVerseVisible()) {
        this.isDiscoveryVisible.set(false);
    }

    try {
        const result = await this.geminiService.findVerseForTheme(theme, this.books().map(b => b.name));
        if (!result || !result.book || !result.chapter || !result.verse) {
             throw new Error('The AI could not find a suitable verse. Please try again.');
        }

        const chapterContent$ = this.bibleService.getChapter(result.book, result.chapter);
        const content = await firstValueFrom(chapterContent$);

        if (!content) {
             throw new Error(`Could not load chapter content for ${result.book} ${result.chapter}.`);
        }

        const foundVerse = content.verses.find(v => v.verse === result.verse);
        if (!foundVerse) {
            throw new Error(`Verse ${result.verse} not found in chapter content for ${result.book} ${result.chapter}.`);
        }
        
        this.focusedVerse.set({
            reference: `${foundVerse.book_name} ${foundVerse.chapter}:${foundVerse.verse}`,
            text: foundVerse.text.trim()
        });
        this.isFocusedVerseVisible.set(true);

    } catch (error) {
        console.error(error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
        this.discoverError.set(errorMessage);
        this.isFocusedVerseVisible.set(false);
        this.isDiscoveryVisible.set(true);
    } finally {
        this.isDiscoverLoading.set(false);
    }
  }

  returnToDiscovery(): void {
    this.isFocusedVerseVisible.set(false);
    this.isDiscoveryVisible.set(true);
    this.focusedVerse.set(null);
    this.currentDiscoveryTheme.set(null);
    this.discoverError.set(null);
  }

  openAppToDefault(): void {
    this.hideCover();
    // Only load if nothing is selected yet
    if (!this.chapterContent()) {
      const genesis = this.books().find(book => book.name === 'Genesis');
      if (genesis) {
        this.selectedBook.set(genesis);
        this.selectChapter(1);
      } else {
        this.isLoading.set(false);
        this.error.set("Genesis book not found for initial load.");
      }
    }
  }

  closeApp(): void {
    this.isAppClosed.set(true);
  }

  returnToCover(): void {
    this.isAppClosed.set(false);
    this.isDiscoveryVisible.set(false);
    this.isFocusedVerseVisible.set(false);
    this.isCoverVisible.set(true);
  }

  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;

    // Ignore clicks on verses, as they are handled by handleVerseClick
    if (target.closest('.verse-paragraph')) {
      return;
    }

    if (this.contextMenu().visible) {
      // If the click is outside the context menu, hide it.
      if (this.contextMenuElement && !this.contextMenuElement.nativeElement.contains(target)) {
        this.hideContextMenu();
      }
    }
  }

  increaseFontSize(): void {
    this.fontSize.update(size => Math.min(this.maxFontSize, size + this.fontSizeStep));
  }

  decreaseFontSize(): void {
    this.fontSize.update(size => Math.max(this.minFontSize, size - this.fontSizeStep));
  }

  toggleTheme(): void {
    this.isDarkMode.update(value => !value);
  }

  handleVerseClick(event: MouseEvent, verseNumber: number): void {
    const currentMenu = this.contextMenu();
    if (currentMenu.visible && currentMenu.verse === verseNumber) {
      this.hideContextMenu();
    } else {
      this.contextMenu.set({
        visible: true,
        x: event.clientX,
        y: event.clientY,
        verse: verseNumber,
      });
    }
  }

  hideContextMenu(): void {
    this.contextMenu.update(state => ({ ...state, visible: false }));
  }

  jumpToVerse(verseNumber: number): void {
    setTimeout(() => {
      const element = document.getElementById(`verse-${verseNumber}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }

  setHighlight(color: HighlightColor): void {
    const verseNumber = this.contextMenu().verse;
    if (verseNumber === null) return;
    
    const book = this.selectedBook();
    const chapter = this.selectedChapter();
    if (!book || !chapter) return;

    const key = `bible-highlight-${book.name}-${chapter}-${verseNumber}`;
    localStorage.setItem(key, color);

    this.verseHighlights.update(highlights => ({
      ...highlights,
      [verseNumber]: color,
    }));
    
    this.hideContextMenu();
  }

  removeHighlight(): void {
    const verseNumber = this.contextMenu().verse;
    if (verseNumber === null) return;

    const book = this.selectedBook();
    const chapter = this.selectedChapter();
    if (!book || !chapter) return;

    const key = `bible-highlight-${book.name}-${chapter}-${verseNumber}`;
    localStorage.removeItem(key);

    this.verseHighlights.update(highlights => {
      const newHighlights = { ...highlights };
      delete newHighlights[verseNumber];
      return newHighlights;
    });

    this.hideContextMenu();
  }

  handleBookSelection(event: Event): void {
    const selectElement = event.target as HTMLSelectElement;
    const bookName = selectElement.value;
    const book = this.books().find(b => b.name === bookName);
    if (book) {
      this.selectedBook.set(book);
      this.selectChapter(1);
    }
  }

  handleChapterSelection(event: Event): void {
    const selectElement = event.target as HTMLSelectElement;
    const chapter = parseInt(selectElement.value, 10);
    this.selectChapter(chapter);
  }

  handleVerseSelection(event: Event): void {
    const selectElement = event.target as HTMLSelectElement;
    const verse = parseInt(selectElement.value, 10);
    if (!isNaN(verse)) {
      this.jumpToVerse(verse);
    }
  }

  handleNotesInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    this.notes.set(textarea.value);
    const key = this.notesKey();
    if (!key) return;

    this.saveStatus.set('saving');
    if (this.notesSaveTimeout) {
      clearTimeout(this.notesSaveTimeout);
    }

    this.notesSaveTimeout = setTimeout(() => {
      localStorage.setItem(key, this.notes());
      this.saveStatus.set('saved');
      setTimeout(() => this.saveStatus.set('idle'), 2000);
    }, 1500);
  }

  selectChapter(chapter: number, verseToJump?: number): void {
    const book = this.selectedBook();
    if (!book) return;

    const key = `bible-notes-${book.name}-${chapter}`;
    this.notes.set(localStorage.getItem(key) ?? '');
    this.saveStatus.set('idle');
    if (this.notesSaveTimeout) {
      clearTimeout(this.notesSaveTimeout);
    }

    this.selectedChapter.set(chapter);
    this.isLoading.set(true);
    this.error.set(null);
    this.chapterContent.set(null);
    this.verseHighlights.set({});
    this.chapterPreamble.set(null); // Reset preamble

    // Check for and set preamble
    const preambleKey = `${book.name}-${chapter}`;
    const preamble = BIBLE_PREAMBLES[preambleKey];
    if (preamble) {
      this.chapterPreamble.set(preamble);
    }

    this.bibleService.getChapter(book.name, chapter).subscribe({
      next: (content) => {
        if (content) {
          this.chapterContent.set(content);
          this.jumpToVerse(verseToJump ?? 1);
          this.saveLastRead(book.name, chapter, verseToJump ?? 1);

          const newHighlights: Record<number, HighlightColor | null> = {};
          for (const verse of content.verses) {
            const highlightKey = `bible-highlight-${book.name}-${chapter}-${verse.verse}`;
            const color = localStorage.getItem(highlightKey) as HighlightColor | null;
            if (color) {
              newHighlights[verse.verse] = color;
            }
          }
          this.verseHighlights.set(newHighlights);

        } else {
          this.error.set('Could not load the chapter. Please try again.');
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.error.set('An error occurred while fetching data. Please check your internet connection.');
        this.isLoading.set(false);
      },
    });
  }

  trackDisplayItem(index: number, item: ChapterDisplayItem): string {
    return item.type === 'verse' ? `verse-${item.data.verse}` : `title-${index}`;
  }

  private scrollTimeout?: ReturnType<typeof setTimeout>;

  onContentScroll(event: Event): void {
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }

    this.scrollTimeout = setTimeout(() => {
      const container = event.target as HTMLElement;
      const book = this.selectedBook();
      const chapter = this.selectedChapter();

      if (!container || !book || !chapter) return;

      const containerTop = container.getBoundingClientRect().top;
      const verses = Array.from(container.querySelectorAll<HTMLElement>('.verse-paragraph'));
      let topVisibleVerse = 1;

      for (const verseEl of verses) {
          const rect = verseEl.getBoundingClientRect();
          if (rect.top >= containerTop) {
              const verseId = verseEl.id.split('-')[1];
              if (verseId) {
                  topVisibleVerse = parseInt(verseId, 10);
              }
              break;
          }
      }

      if (verses.length > 0) {
          const lastVerseEl = verses[verses.length - 1];
          if (lastVerseEl.getBoundingClientRect().top < containerTop) {
               const verseId = lastVerseEl.id.split('-')[1];
               if (verseId) {
                  topVisibleVerse = parseInt(verseId, 10);
               }
          }
      }

      this.saveLastRead(book.name, chapter, topVisibleVerse);
    }, 250);
  }

  saveLastRead(book: string, chapter: number, verse: number): void {
    const location = { book, chapter, verse };
    this.lastRead.set(location);
    localStorage.setItem(this.LAST_READ_KEY, JSON.stringify(location));
  }

  async shareVerse(reference: string, text: string): Promise<void> {
    const shareText = `"${text}" - ${reference}`;
    // The Web Share API is preferred
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Bible Verse',
          text: shareText,
          url: window.location.href, // Using current URL as context
        });
      } catch (error) {
        console.error('Error sharing:', error);
      }
    } else {
      // Fallback to clipboard for browsers that don't support Web Share API
      try {
        await navigator.clipboard.writeText(shareText);
        this.shareStatus.set('copied');
        setTimeout(() => this.shareStatus.set('idle'), 2000);
      } catch (error) {
        console.error('Error copying to clipboard:', error);
        alert('Could not copy text to clipboard.');
      }
    }
  }
  
  shareFocusedVerse(): void {
    const verse = this.focusedVerse();
    if (verse) {
      this.shareVerse(verse.reference, verse.text);
    }
  }
  
  shareVerseFromMainView(event: MouseEvent, verse: Verse): void {
    event.stopPropagation(); // Prevent the click from triggering the highlight menu
    const reference = `${verse.book_name} ${verse.chapter}:${verse.verse}`;
    this.shareVerse(reference, verse.text.trim());
  }
}