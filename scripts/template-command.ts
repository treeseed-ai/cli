#!/usr/bin/env node

import { listTemplateProducts, resolveTemplateProduct, serializeTemplateRegistryEntry, validateTemplateProduct } from './template-registry-lib.ts';

const [action = 'list', target] = process.argv.slice(2);

switch (action) {
	case 'list': {
		for (const product of listTemplateProducts()) {
			console.log(`${product.id}\t${product.displayName}\t${product.description}`);
		}
		break;
	}
	case 'show': {
		if (!target) {
			throw new Error('Usage: treeseed template show <id>');
		}
		console.log(JSON.stringify(serializeTemplateRegistryEntry(resolveTemplateProduct(target)), null, 2));
		break;
	}
	case 'validate': {
		const products = target ? [resolveTemplateProduct(target)] : listTemplateProducts();
		for (const product of products) {
			validateTemplateProduct(product);
			console.log(`validated ${product.id}`);
		}
		break;
	}
	default:
		throw new Error(`Unknown template action: ${action}`);
}
