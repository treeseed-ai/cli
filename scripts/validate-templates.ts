#!/usr/bin/env node

import { validateAllTemplateDefinitions } from './template-registry-lib.ts';

const definitions = await validateAllTemplateDefinitions({
	writeWarning: (message) => console.warn(message),
});

console.log(`Validated ${definitions.length} template definition${definitions.length === 1 ? '' : 's'}.`);
