import { Object, util, IText, Group, ActiveSelection } from 'fabric'

const isMac = navigator.userAgent.indexOf('Mac OS X') != -1

const shell = document.querySelector('app-shell')

const currentSelected = () => shell.renderRoot.querySelector('custom-pages').querySelector('draw-field.custom-selected')
let currentObjectInClipboard

addEventListener('keydown', async event => {
  const field = currentSelected()
  const canvas = field.canvas
  if (event.metaKey && isMac && event.key === 'Backspace' || event.key === 'Backspace' && !isMac) {
    let items = field.canvas.getActiveObjects()
    
    for (const item of items) {
      if (item.type === 'activeselection') {
        for (const _item of item._objects) {
          field.canvas.remove(_item)
        }
      }
      canvas.remove(item)
      canvas.discardActiveObject();
    }
    
   
  }

  if (event.metaKey && event.key === 'a' || event.ctrlKey && event.key === 'a') {

    canvas.discardActiveObject();
    var sel = new ActiveSelection(canvas.getObjects(), {
      canvas: canvas,
    });
    canvas.setActiveObject(sel);
  }


  if (event.metaKey && isMac && event.key === 'c' || event.ctrlKey && event.key === 'c' && !isMac) {

    
    const items = field.canvas.getActiveObjects()

    const activeGroup = items[0].group || items[0]

    const group = new Group(items, {
      left: activeGroup.left,
      top: activeGroup.top
    })

    for (const item of items) {
      field.canvas.remove(item)
    }
    
    field.canvas.add(group)

    currentObjectInClipboard = group
  }

  if (event.metaKey && isMac && event.key === 'x' || event.ctrlKey && event.key === 'x' && !isMac) {
    
    const items = field.canvas.getActiveObjects()

    const activeGroup = items[0].group || items[0]
    
    for (const item of items) {
      if (item.type === 'activeselection') {
        for (const _item of item._objects) {
          field.canvas.remove(_item)
        }
      }
      canvas.remove(item)
      canvas.discardActiveObject();
    }


    const group = new Group(items, {
      left: activeGroup.left,
      top: activeGroup.top
    })

    currentObjectInClipboard = group
   
  }

  if (event.metaKey && isMac && event.ctrlKey && event.key === 'g' || event.ctrlKey && event.key === 'g' && !isMac) {
    
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
    
    console.log(json);
    await field.canvas.add(json)
    // field.canvas.renderAll.bind(field.canvas)
    // currentMousePosition
    console.log(json);
  }

  if (event.metaKey && isMac && event.ctrlKey && event.key === 't' || event.ctrlKey && event.key === 't' && !isMac) { 
    await field.canvas.add(new IText('Tap and Type', { 
      fontFamily: 'system-ui',
      fontSize: 12,
      fontStyle: 'normal',
      fontWeight: 'normal',
      left: currentMousePosition.x - shell.drawer.getBoundingClientRect().width, 
      top: currentMousePosition.y
    }))
  }

  if (event.metaKey && isMac && event.key === 's' || event.ctrlKey && event.key === 's' && !isMac) {
    event.preventDefault()
    shell.save()
  }
 

  field.canvas.renderAll()
  
  // console.log(event);
  
})