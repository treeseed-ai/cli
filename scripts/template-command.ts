#!/usr/bin/env node

import { listTemplateProducts, resolveTemplateProduct, serializeTemplateRegistryEntry, validateTemplateProduct } from './template-registry-lib.ts';

const [action = 'list', target] = process.argv.slice(2);
const writeWarning = (message: string) => console.warn(message);

switch (action) {
	case 'list': {
		for (const product of await listTemplateProducts({ writeWarning })) {
			console.log(`${product.id}\t${product.displayName}\t${product.description}`);
		}
		break;
	}
	case 'show': {
		if (!target) {
			throw new Error('Usage: treeseed template show <id>');
		}
		console.log(JSON.stringify(serializeTemplateRegistryEntry(await resolveTemplateProduct(target, { writeWarning })), null, 2));
		break;
	}
	case 'validate': {
		const products = target
			? [await resolveTemplateProduct(target, { writeWarning })]
			: await listTemplateProducts({ writeWarning });
		for (const product of products) {
			await validateTemplateProduct(product, { writeWarning });
			console.log(`validated ${product.id}`);
		}
		break;
	}
	default:
		throw new Error(`Unknown template action: ${action}`);
}
