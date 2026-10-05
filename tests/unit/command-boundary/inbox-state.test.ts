import assert from 'node:assert/strict';
import test from 'node:test';
import { InboxNavigation, inboxRow, preserveSelection, type InboxItem } from '../../../src/cli/inbox/inbox-state.ts';

const item={id:'proposal-1',projectId:'sdk',projectSlug:'sdk',kind:'proposal',title:'A governed proposal',status:'outstanding',updatedAt:'2026-08-29T12:00:00.000Z',version:1,etag:'one'} as const;
test('inbox selection remains attached to identity when the timeline reorders',()=>{assert.equal(preserveSelection([{...item,id:'proposal-2'},item],'proposal-1'),'proposal-1');assert.equal(preserveSelection([{...item,id:'proposal-2'}],'proposal-1'),'proposal-2');});
test('inbox browser navigation supports back, parent, and forward',()=>{const navigation=new InboxNavigation();navigation.visit({itemId:'proposal-1'});navigation.visit({itemId:'proposal-1',commentId:'reply-1'});assert.deepEqual(navigation.back(),{itemId:'proposal-1'});assert.deepEqual(navigation.forward(),{itemId:'proposal-1',commentId:'reply-1'});const detailed={...item,markdown:'body',authorLabel:'Agent',createdAt:item.updatedAt,discussionId:'discussion-1',availableActions:[],comments:[{id:'reply-1',parentId:null,kind:'reply',authorLabel:'Reviewer',markdown:'note',createdAt:item.updatedAt}]} as InboxItem;assert.deepEqual(navigation.parent(detailed),{itemId:'proposal-1'});});
test('inbox rows reserve room for update time',()=>{const row=inboxRow(item,30,new Date('2026-08-29T12:05:00.000Z').getTime());assert.equal(row.length,30);assert.match(row,/5m$/u);});
