export type InboxSummary = { id: string; projectId: string; projectSlug: string; kind: 'proposal'|'question'; title: string; status: string; updatedAt: string; version: number; etag: string };
export type InboxComment = { id: string; parentId: string|null; kind: 'comment'|'answer'|'reply'; authorLabel: string; markdown: string; createdAt: string };
export type InboxItem = InboxSummary & { markdown: string; authorLabel: string; createdAt: string; discussionId: string|null; comments: InboxComment[]; availableActions: Array<{action:string;label:string;enabled:boolean;reason:string|null;requiresFeedback:boolean;confirmation:string}> };
export type InboxLocation = { itemId: string; commentId?: string };

export class InboxNavigation {
	private entries: InboxLocation[] = [];
	private index = -1;
	visit(location: InboxLocation) { const current=this.current(); if(current?.itemId===location.itemId&&current.commentId===location.commentId)return; this.entries=this.entries.slice(0,this.index+1);this.entries.push(location);this.index=this.entries.length-1; }
	back() { if(this.index>0)this.index--;return this.current(); }
	forward() { if(this.index+1<this.entries.length)this.index++;return this.current(); }
	parent(item: InboxItem) { const current=this.current();if(!current?.commentId)return current;const comment=item.comments.find(value=>value.id===current.commentId);const location={itemId:item.id,...(comment?.parentId?{commentId:comment.parentId}:{})};this.visit(location);return location; }
	current() { return this.entries[this.index] ?? null; }
	get canBack(){return this.index>0;} get canForward(){return this.index+1<this.entries.length;}
}

export function preserveSelection(items: InboxSummary[], selectedId: string|null) { return selectedId && items.some(item=>item.id===selectedId) ? selectedId : items[0]?.id ?? null; }
export function inboxRow(item: InboxSummary, width: number, now = Date.now()) { const age=Math.max(0,now-new Date(item.updatedAt).getTime()), time=age<60_000?'now':age<3_600_000?`${Math.floor(age/60_000)}m`:age<86_400_000?`${Math.floor(age/3_600_000)}h`:new Date(item.updatedAt).toLocaleDateString();const room=Math.max(4,width-time.length-1);return `${item.title.slice(0,room).padEnd(room)} ${time}`; }
