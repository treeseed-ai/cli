import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Text, measureElement, useInput, useStdout, type DOMElement } from 'ink';

type MouseEvent = { x:number; y:number; button:number; motion:boolean; release:boolean };
type MouseHandlers = { press?:(event:MouseEvent)=>void; drag?:(event:MouseEvent)=>void; release?:(event:MouseEvent)=>void; wheel?:(direction:-1|1)=>void };
type Region = { node:React.RefObject<DOMElement|null>; handlers:MouseHandlers };
type MouseContextValue = { register:(id:string,region:Region)=>()=>void };

const MouseContext=createContext<MouseContextValue>({register:()=>()=>undefined});

export function MouseProvider({children}:{children:ReactNode}) {
	const regions=useRef(new Map<string,Region>()),dragging=useRef<string|null>(null),{stdout}=useStdout();
	const register=useCallback((id:string,region:Region)=>{regions.current.set(id,region);return()=>{regions.current.delete(id);};},[]);
	useEffect(()=>{
		const locate=(x:number,y:number)=>[...regions.current.entries()].reverse().find(([,region])=>{if(!region.node.current)return false;const box=measureElement(region.node.current);return x>=box.x&&x<box.x+box.width&&y>=box.y&&y<box.y+box.height;});
		const input=(chunk:Buffer)=>{const source=chunk.toString('utf8');for(const match of source.matchAll(/\u001b\[<(\d+);(\d+);(\d+)([mM])/gu)){const code=Number(match[1]),event:MouseEvent={button:code&3,x:Number(match[2])-1,y:Number(match[3])-1,motion:Boolean(code&32),release:match[4]==='m'};if(code&64){locate(event.x,event.y)?.[1].handlers.wheel?.((code&1)?1:-1);continue;}if(event.release){if(dragging.current)regions.current.get(dragging.current)?.handlers.release?.(event);dragging.current=null;continue;}if(event.motion&&dragging.current){regions.current.get(dragging.current)?.handlers.drag?.(event);continue;}const found=locate(event.x,event.y);if(found){dragging.current=found[0];found[1].handlers.press?.(event);}}};
		stdout.write('\u001b[?1000h\u001b[?1002h\u001b[?1006h');process.stdin.on('data',input);
		return()=>{process.stdin.removeListener('data',input);stdout.write('\u001b[?1000l\u001b[?1002l\u001b[?1006l');};
	},[stdout]);
	return <MouseContext.Provider value={{register}}>{children}</MouseContext.Provider>;
}

export function MouseRegion({id,handlers,children,...boxProps}:{id:string;handlers:MouseHandlers;children:ReactNode}&React.ComponentProps<typeof Box>) {
	const node=useRef<DOMElement|null>(null),{register}=useContext(MouseContext);
	useLayoutEffect(()=>register(id,{node,handlers}),[id,register,handlers]);
	return <Box ref={node} {...boxProps}>{children}</Box>;
}

export function useTerminalSize() {
	const {stdout}=useStdout(),[size,setSize]=useState(()=>({width:stdout.columns??80,height:stdout.rows??24}));
	useEffect(()=>{const resize=()=>setSize({width:stdout.columns??80,height:stdout.rows??24});stdout.on('resize',resize);return()=>{stdout.removeListener('resize',resize);};},[stdout]);
	return size;
}

type Tone='cyan'|'blue'|'green'|'magenta'|'yellow'|'red'|'gray';
export function Panel({title,children,tone='cyan',...props}:{title:string;children:ReactNode;tone?:Tone}&React.ComponentProps<typeof Box>) {
	return <Box borderStyle="round" borderColor={tone} flexDirection="column" {...props}><Box marginLeft={1}><Text color={tone} bold>{title}</Text></Box>{children}</Box>;
}

export function WorkbenchButton({id,label,onPress,active=false,disabled=false,width}:{id:string;label:string;onPress:()=>void;active?:boolean;disabled?:boolean;width?:number|string}) {
	const handlers={press:()=>{if(!disabled)onPress();}};
	return <MouseRegion id={id} handlers={handlers} width={width} aria-role="button"><Text color={disabled?'gray':active?'black':'white'} backgroundColor={active?'cyan':'blue'} dimColor={disabled}> {label} </Text></MouseRegion>;
}

export type SelectItem={id:string;label:string;selected?:boolean;disabled?:boolean};
export function SelectableList({id,items,height,active,onSelect}:{id:string;items:SelectItem[];height:number;active:boolean;onSelect:(id:string)=>void}) {
	const [index,setIndex]=useState(0),[offset,setOffset]=useState(0),visible=Math.max(1,height);
	useEffect(()=>{setIndex(value=>Math.min(Math.max(0,value),Math.max(0,items.length-1)));},[items.length]);
	useEffect(()=>{if(index<offset)setOffset(index);else if(index>=offset+visible)setOffset(index-visible+1);},[index,offset,visible]);
	useInput((_input,key)=>{if(!active)return;if(key.upArrow)setIndex(value=>Math.max(0,value-1));else if(key.downArrow)setIndex(value=>Math.min(items.length-1,value+1));else if(key.return&&items[index]&&!items[index]?.disabled)onSelect(items[index]!.id);},{isActive:active});
	const shown=items.slice(offset,offset+visible);
	return <Box flexDirection="column" height={height} overflow="hidden">{shown.map((item,row)=><MouseRegion key={item.id} id={`${id}:${item.id}`} handlers={{press:()=>{setIndex(offset+row);if(!item.disabled)onSelect(item.id);}}}><Text wrap="truncate-end" inverse={active&&offset+row===index} color={item.disabled?'gray':item.selected?'cyan':'white'}>{item.label}</Text></MouseRegion>)}</Box>;
}

export function WorkbenchModal({title,children,height,tone='magenta'}:{title:string;children:ReactNode;height:number;tone?:Tone}) {
	return <Panel title={`◆ ${title}`} tone={tone} height={height} paddingX={2} paddingY={1}>{children}</Panel>;
}

export function SelectionOverlay({id,title,items,selected,height,onSelect,onCancel}:{id:string;title:string;items:SelectItem[];selected:string;height:number;onSelect:(id:string)=>void;onCancel:()=>void}) {
	const rows=Math.max(3,Math.min(items.length,height-7));
	return <WorkbenchModal title={title} height={height} tone="blue">
		<Text color="gray">Choose with the mouse or arrow keys, then press Enter.</Text>
		<Box marginTop={1} borderStyle="single" borderColor="blue" paddingX={1} flexDirection="column">
			<SelectableList id={id} items={items.map(item=>({...item,selected:item.id===selected}))} height={rows} active onSelect={onSelect}/>
		</Box>
		<Box marginTop={1}><WorkbenchButton id={`${id}:cancel`} label="Cancel" onPress={onCancel}/></Box>
	</WorkbenchModal>;
}

function cursorMoveVertical(value:string,cursor:number,direction:-1|1){const before=value.slice(0,cursor),column=before.length-(before.lastIndexOf('\n')+1);if(direction<0){const lineStart=before.lastIndexOf('\n');if(lineStart<0)return cursor;const previousEnd=lineStart,previousStart=value.lastIndexOf('\n',previousEnd-1)+1;return previousStart+Math.min(column,previousEnd-previousStart);}const nextStart=value.indexOf('\n',cursor);if(nextStart<0)return cursor;const afterStart=nextStart+1,nextEnd=value.indexOf('\n',afterStart);return afterStart+Math.min(column,(nextEnd<0?value.length:nextEnd)-afterStart);}

export function MarkdownEditor({id,value,onChange,height,active,onFocus,onSubmit,placeholder='Write Markdown…'}:{id:string;value:string;onChange:(value:string)=>void;height:number;active:boolean;onFocus:()=>void;onSubmit?:()=>void;placeholder?:string}) {
	const [cursor,setCursor]=useState(value.length);
	useEffect(()=>setCursor(position=>Math.min(position,value.length)),[value.length]);
	useInput((input,key)=>{if(!active||input.includes('\u001b[<')||input.includes('[<'))return;if(key.return){if(key.meta){onChange(value.slice(0,cursor)+'\n'+value.slice(cursor));setCursor(cursor+1);}else onSubmit?.();return;}if(key.backspace){if(cursor){onChange(value.slice(0,cursor-1)+value.slice(cursor));setCursor(cursor-1);}return;}if(key.delete){onChange(value.slice(0,cursor)+value.slice(cursor+1));return;}if(key.leftArrow){setCursor(Math.max(0,cursor-1));return;}if(key.rightArrow){setCursor(Math.min(value.length,cursor+1));return;}if(key.upArrow){setCursor(cursorMoveVertical(value,cursor,-1));return;}if(key.downArrow){setCursor(cursorMoveVertical(value,cursor,1));return;}if(input&&!key.ctrl&&!key.meta){onChange(value.slice(0,cursor)+input+value.slice(cursor));setCursor(cursor+input.length);}},{isActive:active});
	const shown=value||placeholder,before=value?shown.slice(0,cursor):'',at=value?(shown[cursor]??' '):shown[0]??' ',after=value?shown.slice(cursor+1):shown.slice(1);
	return <MouseRegion id={id} handlers={{press:onFocus}} height={height} flexDirection="column" overflow="hidden" paddingX={1}><Text wrap="wrap" dimColor={!value}><Text>{before}</Text><Text inverse={active}>{at}</Text><Text>{after}</Text></Text></MouseRegion>;
}

function wrappedRows(value:string,width:number){const output:string[]=[];for(const source of value.split('\n')){let remaining=source;if(!remaining){output.push('');continue;}while(remaining.length>width){let cut=remaining.lastIndexOf(' ',width);if(cut<Math.floor(width*.5))cut=width;output.push(remaining.slice(0,cut));remaining=remaining.slice(cut).trimStart();}output.push(remaining);}return output;}
export function MarkdownViewer({id,value,height,width,active,onFocus,follow=false}:{id:string;value:string;height:number;width:number;active:boolean;onFocus:()=>void;follow?:boolean}) {
	const rows=wrappedRows(value,Math.max(8,width)),[offset,setOffset]=useState(Math.max(0,rows.length-height));
	useEffect(()=>{if(follow)setOffset(Math.max(0,rows.length-height));else setOffset(value=>Math.min(value,Math.max(0,rows.length-height)));},[rows.length,height,follow]);
	const scroll=(direction:-1|1)=>setOffset(value=>Math.max(0,Math.min(rows.length-height,value+direction*3)));
	useInput((_input,key)=>{if(!active)return;if(key.upArrow)scroll(-1);if(key.downArrow)scroll(1);if(key.pageUp)setOffset(value=>Math.max(0,value-height));if(key.pageDown)setOffset(value=>Math.min(Math.max(0,rows.length-height),value+height));},{isActive:active});
	return <MouseRegion id={id} handlers={{press:onFocus,wheel:scroll}} height={height} flexDirection="column" overflow="hidden" paddingX={1}>{rows.slice(offset,offset+height).map((line,index)=><Text wrap="truncate-end" key={`${offset+index}:${line}`} color={line.startsWith('#')?'cyan':line.startsWith('```')?'magenta':undefined} bold={line.startsWith('#')}>{line||' '}</Text>)}</MouseRegion>;
}

export type TimelineEntry={id:string;title:string;body:string;tone:'user'|'agent'|'notice'|'error'};
type TimelineRow={key:string;text:string;tone:TimelineEntry['tone'];role:'header'|'body'|'separator'};
function timelineRows(entries:TimelineEntry[],width:number){const rows:TimelineRow[]=[];for(const entry of entries){if(entry.tone==='notice'||entry.tone==='error'){for(const [index,line] of wrappedRows(`• ${entry.title}${entry.body?` — ${entry.body}`:''}`,width).entries())rows.push({key:`${entry.id}:notice:${index}`,text:line,tone:entry.tone,role:'header'});rows.push({key:`${entry.id}:space`,text:'',tone:entry.tone,role:'separator'});continue;}rows.push({key:`${entry.id}:header`,text:`◆ ${entry.title}`,tone:entry.tone,role:'header'});for(const [index,line] of wrappedRows(entry.body,width-2).entries())rows.push({key:`${entry.id}:body:${index}`,text:`  ${line}`,tone:entry.tone,role:'body'});rows.push({key:`${entry.id}:rule`,text:'─'.repeat(Math.max(8,width)),tone:entry.tone,role:'separator'});}return rows;}
export function TimelineViewer({id,entries,height,width,active,onFocus,follow=false}:{id:string;entries:TimelineEntry[];height:number;width:number;active:boolean;onFocus:()=>void;follow?:boolean}) {
	const rows=timelineRows(entries,Math.max(12,width)),[offset,setOffset]=useState(Math.max(0,rows.length-height));
	useEffect(()=>{if(follow)setOffset(Math.max(0,rows.length-height));else setOffset(value=>Math.min(value,Math.max(0,rows.length-height)));},[rows.length,height,follow]);
	const scroll=(direction:-1|1)=>setOffset(value=>Math.max(0,Math.min(Math.max(0,rows.length-height),value+direction*3)));
	useInput((_input,key)=>{if(!active)return;if(key.upArrow)scroll(-1);if(key.downArrow)scroll(1);if(key.pageUp)setOffset(value=>Math.max(0,value-height));if(key.pageDown)setOffset(value=>Math.min(Math.max(0,rows.length-height),value+height));},{isActive:active});
	return <MouseRegion id={id} handlers={{press:onFocus,wheel:scroll}} height={height} flexDirection="column" overflow="hidden" paddingX={1}>{rows.slice(offset,offset+height).map(row=>{
		const color=row.tone==='user'?'cyan':row.tone==='agent'?'green':row.tone==='error'?'red':'yellow';
		return <Text key={row.key} color={row.role==='body'?'white':color} bold={row.role==='header'} dimColor={row.role==='separator'||row.tone==='notice'} wrap="truncate-end">{row.text||' '}</Text>;
	})}</MouseRegion>;
}

export function Splitter({id,onDrag}:{id:string;onDrag:(terminalY:number)=>void}) {
	const handlers={press:(event:MouseEvent)=>onDrag(event.y),drag:(event:MouseEvent)=>onDrag(event.y)};
	return <MouseRegion id={id} handlers={handlers} height={1} justifyContent="center"><Text color="cyan">━━━━━━━━━━━━ ↕ drag to resize ━━━━━━━━━━━━</Text></MouseRegion>;
}

export function enterWorkbench(stdout:NodeJS.WriteStream){stdout.write('\u001b[?1049h\u001b[2J\u001b[H\u001b[?25l');}
export function leaveWorkbench(stdout:NodeJS.WriteStream){stdout.write('\u001b[?25h\u001b[?1049l');}
