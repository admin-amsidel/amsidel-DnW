/*
 * Copyright (c) 2026 AMSIDEL Technologies. All rights reserved.
 * Designed and developed by AMSIDEL Technologies.
 */
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';

// A fully static site: no backend. Enquiry emails go straight from the browser through EmailJS (shared/enquiry.ts).
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
    ),
  ],
};
