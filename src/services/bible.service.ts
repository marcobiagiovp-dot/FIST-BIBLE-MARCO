import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { BIBLE_BOOKS } from '../bible-books';
import { Book } from '../models/book.model';

export interface Verse {
  book_id: string;
  book_name: string;
  chapter: number;
  verse: number;
  text: string;
}

export interface ChapterContent {
  reference: string;
  verses: Verse[];
  text: string;
  translation_id: string;
  translation_name: string;
  translation_note: string;
}

@Injectable({
  providedIn: 'root',
})
export class BibleService {
  private http = inject(HttpClient);
  private apiUrl = 'https://bible-api.com/';

  getBooks(): Book[] {
    return BIBLE_BOOKS;
  }

  getChapter(bookName: string, chapter: number): Observable<ChapterContent | null> {
    const formattedBookName = bookName.replace(/\s/g, '+');
    return this.http.get<ChapterContent>(`${this.apiUrl}${formattedBookName}+${chapter}?translation=kjv`).pipe(
      catchError(error => {
        console.error('Error fetching chapter:', error);
        return of(null);
      })
    );
  }
}