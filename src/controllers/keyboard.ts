import { Object, util, IText, Group, ActiveSelection } from 'fabric'

const isMac = navigator.userAgent.indexOf('Mac OS X') != -1

const shell = document.querySelector('app-shell')

const currentSelected = () => shell.renderRoot.querySelector('custom-pages').querySelector('draw-field.custom-selected')
let currentObjectInClipboard

addEventListener('keydown', async event => {
  const field = currentSelected()
  const canvas = field.canvas
  if (event.metaKey && isMac && event.key === 'Backspace' || event.ctrlKey && event.key === 'Backspace' && !isMac) {
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
    event.preventDefault()
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

    currentObjectInClipboard = group.clone()
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

    currentObjectInClipboard = group.clone()
   
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

  if (event.metaKey && isMac && event.ctrlKey && event.key === 'u' || event.ctrlKey && event.key === 'u' && !isMac) {
   console.log('u');
   event.preventDefault()
    let items = field.canvas.getActiveObjects()
console.log(items);

    canvas.discardActiveObject();

    for(const item of items[0]._objects) {
          canvas.add(item);
        
          

    }
    canvas.renderAll()
  }

  if (event.metaKey && isMac && event.key === 'v' || event.ctrlKey && event.key === 'v' && !isMac) {
    // const json = await currentObjectInClipboard.cloneAsImage()
    const json = await currentObjectInClipboard
    let x = currentMousePosition.x - shell.drawer.getBoundingClientRect().width
    let y = currentMousePosition.y // - shell.header.width
    json.left = x - (json.width / 2)
    json.top = y - (json.height / 2)
    await field.canvas.add(json)
    currentObjectInClipboard = undefined
    // field.canvas.renderAll.bind(field.canvas)
    // currentMousePosition
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

  const moveObject = (object, direction: 'left' | 'right' | 'down' | 'up', amount) => {
    canvas.remove(object)
console.log(object);

    if (direction === 'left') object.left = Math.round((object.left - amount) *  100 ) / 100
    if (direction === 'right') object.left = Math.round((object.left + amount) *  100 ) / 100
    if (direction === 'up') object.top = Math.round((object.top - amount) *  100 ) / 100
    if (direction === 'down') object.top = Math.round((object.top + amount) *  100 ) / 100
    
    canvas.add(object)
  }

  const moveObjects = (direction: 'left' | 'right' | 'down' | 'up', amount?: number) => {
    amount = amount || 0.5
    let items = canvas.getActiveObjects()
    console.log(items);
    
    // canvas.discardActiveObject();

    for (const item of items) {
      if (item.type === 'activeselection') {
        canvas.remove(item)
        for (const _item of item._objects) {
          moveObject(_item, direction,  amount)
          canvas.setActiveObject(_item);
        }
      } else {
        moveObject(item, direction,  amount)
        canvas.setActiveObject(item);
      }
    }
    
  }

  if (event.metaKey && isMac && event.key === 'ArrowRight' || event.ctrlKey && event.key === 'ArrowRight' && !isMac) {
    moveObjects('right')
  }

  if (event.metaKey && isMac && event.key === 'ArrowLeft' || event.ctrlKey && event.key === 'ArrowLeft' && !isMac) {
    moveObjects('left')
  }

  if (event.metaKey && isMac && event.key === 'ArrowUp' || event.ctrlKey && event.key === 'ArrowUp' && !isMac) {
    moveObjects('up')
  }

  if (event.metaKey && isMac && event.key === 'ArrowDown' || event.ctrlKey && event.key === 'ArrowDown' && !isMac) {
    moveObjects('down')
  }
 

  field.canvas.renderAll()
  
  // console.log(event);
  
})