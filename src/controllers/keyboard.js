import { Object, util, IText, Group } from 'fabric'

const isMac = navigator.userAgent.indexOf('Mac OS X') != -1

const shell = document.querySelector('app-shell')

const currentSelected = () => shell.renderRoot.querySelector('custom-pages').querySelector('draw-field.custom-selected')
let currentObjectInClipboard

addEventListener('keydown', async event => {
  
  if (event.metaKey && isMac || event.key === 'Delete' && !isMac) {
   if (event.key === 'Backspace') {
    const field = currentSelected()
    field.canvas.remove(field.canvas.getActiveObject())
   }
  }

  if (event.metaKey && isMac && event.key === 'c' || event.ctrlKey && event.key === 'c' && !isMac) {

    const field = currentSelected()
    const target = field.canvas.getActiveObjects()[0]?.group || field.canvas.getActiveObjects()[0]
    currentObjectInClipboard = target
  }

  if (event.metaKey && isMac && event.key === 'x' || event.ctrlKey && event.key === 'x' && !isMac) {
    const field = currentSelected()
    const target = field.canvas.getActiveObjects()[0]
    currentObjectInClipboard = target.group || target
    console.log(target);
    field.canvas.remove(target)
  }

  if (event.metaKey && isMac && event.ctrlKey && event.key === 'g' || event.ctrlKey && event.key === 'g' && !isMac) {
    const field = currentSelected()
    let items = field.canvas.getActiveObjects()
    const group = field.canvas.getActiveObjects()[0].group;
    // items = items.map(i => field.canvas.item(i.index))

    for (const item of items) {
      field.canvas.remove(item)
    }
    
    field.canvas.add(new Group(items, {
      left: group.left,
      top: group.top
    }))
  }

  if (event.metaKey && isMac && event.key === 'v' || event.ctrlKey && event.key === 'v' && !isMac) {
    // const json = await currentObjectInClipboard.cloneAsImage()
    const json = await currentObjectInClipboard.clone()
    let x = currentMousePosition.x - shell.drawer.getBoundingClientRect().width
    let y = currentMousePosition.y // - shell.header.width
    json.left = x - (json.width / 2)
    json.top = y - (json.height / 2)
    const field = currentSelected()
    console.log(json);
    await field.canvas.add(json)
    // field.canvas.renderAll.bind(field.canvas)
    // currentMousePosition
    console.log(json);
  }

  if (event.metaKey && isMac && event.ctrlKey && event.key === 't' || event.ctrlKey && event.key === 't' && !isMac) { 
   
    const field = currentSelected()
    await field.canvas.add(new IText('Tap and Type', { 
      fontFamily: 'system-ui',
      fontSize: 12,
      fontStyle: 'normal',
      fontWeight: 'normal',
      left: currentMousePosition.x - shell.drawer.getBoundingClientRect().width, 
      top: currentMousePosition.y
    }))
  }

 

  
  
  // console.log(event);
  
})