import { ActiveSelection } from "fabric";
import { canvas } from "../../../utils.js"
import { isMac } from "../utils.js"

export const isSelectAll = ({ metaKey, ctrlKey, key }: KeyboardEvent) => key === 'a' && isMac ? metaKey : ctrlKey

export const selectAll = () => {
  canvas.discardActiveObject();
  // @ts-ignore
  var selection = new ActiveSelection(canvas.getObjects(), {
    canvas: canvas,
  });
  // @ts-ignore
  canvas.setActiveObject(selection);
}