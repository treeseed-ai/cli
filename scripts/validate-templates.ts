#!/usr/bin/env node

import { listTemplateProducts, validateTemplateProduct } from './template-registry-lib.ts';

const definitions = listTemplateProducts();
for (const definition of definitions) {
	validateTemplateProduct(definition);
}

console.log(`Validated ${definitions.length} template definition${definitions.length === 1 ? '' : 's'}.`);
