const fs = require('fs');
const markdownToc = require('markdown-toc');
const path = require('path');
const Documentation = require('./Documentation');
const commonmark = require('commonmark');

class MDOutline {
  /**
   * @param {!Page} page
   * @param {string} text
   * @return {!MDOutline}
   */
  static async create(page, text) {
    // Render markdown as HTML.
    const reader = new commonmark.Parser();
    const parsed = reader.parse(text);
    const writer = new commonmark.HtmlRenderer();
    const html = writer.render(parsed);

    // Extract headings.
    await page.setContent(html);
    const {classes, errors} = await page.evaluate(() => {
      let classes = [];
      let currentClass = {};
      let member = {};
      let errors = [];
      for (let element of document.body.querySelectorAll('h3, h4, h4 + ul > li')) {
        if (element.matches('h3')) {
          currentClass = {
            name: element.textContent,
            members: [],
          };
          classes.push(currentClass);
        } else if (element.matches('h4')) {
          member = {
            name: element.textContent,
            args: [],
            hasReturn: false
          };
          currentClass.members.push(member);
        } else if (element.matches('li') && element.firstChild.matches && element.firstChild.matches('code')) {
          member.args.push(element.firstChild.textContent);
        } else if (element.matches('li') && element.firstChild.nodeType === Element.TEXT_NODE && element.firstChild.textContent.toLowerCase().startsWith('retur')) {
          member.hasReturn = true;
          const expectedText = 'returns: ';
          let actualText = element.firstChild.textContent;
          let angleIndex = actualText.indexOf('<');
          let spaceIndex = actualText.indexOf(' ');
          angleIndex = angleIndex === -1 ? angleText.length : angleIndex;
          spaceIndex = spaceIndex === -1 ? spaceIndex.length : spaceIndex + 1;
          actualText = actualText.substring(0, Math.min(angleIndex, spaceIndex));
          if (actualText !== expectedText)
            errors.push(`${member.name} has mistyped 'return' type declaration: expected exactly '${expectedText}', found '${actualText}'.`);
        }
      }
      return {classes, errors};
    });
    return new MDOutline(classes, errors);
  }

  constructor(classes, errors) {
    this.classes = [];
    this.errors = errors;
    const classHeading = /^class: (\w+)$/;
    const constructorRegex = /^new (\w+)\((.*)\)$/;
    const methodRegex = /^(\w+)\.(\w+)\((.*)\)$/;
    const propertyRegex = /^(\w+)\.(\w+)$/;
    const eventRegex = /^event: '(\w+)'$/;
    let currentClassName = null;
    let currentClassMembers = [];
    for (const cls of classes) {
      let match = cls.name.match(classHeading);
      if (!match)
        continue;
      currentClassName = match[1];
      for (let member of cls.members) {
        if (constructorRegex.test(member.name)) {
          let match = member.name.match(constructorRegex);
          handleMethod.call(this, member, match[1], 'constructor', match[2]);
        } else if (methodRegex.test(member.name)) {
          let match = member.name.match(methodRegex);
          handleMethod.call(this, member, match[1], match[2], match[3]);
        } else if (propertyRegex.test(member.name)) {
          let match = member.name.match(propertyRegex);
          handleProperty.call(this, member, match[1], match[2]);
        } else if (eventRegex.test(member.name)) {
          let match = member.name.match(eventRegex);
          handleEvent.call(this, member, match[1]);
        }
      }
      flushClassIfNeeded.call(this);
    }

    function handleMethod(member, className, methodName, parameters) {
      if (!currentClassName || !className || !methodName || className.toLowerCase() !== currentClassName.toLowerCase()) {
        this.errors.push(`Failed to process header as method: ${member.name}`);
        return;
      }
      parameters = parameters.trim().replace(/[\[\]]/g, '');
      if (parameters !== member.args.join(', '))
        this.errors.push(`Heading arguments for "${member.name}" do not match described ones, i.e. "${parameters}" != "${member.args.join(', ')}"`);
      let args = member.args.map(arg => new Documentation.Argument(arg));
      let method = Documentation.Member.createMethod(methodName, args, member.hasReturn, false);
      currentClassMembers.push(method);
    }

    function handleProperty(member, className, propertyName) {
      if (!currentClassName || !className || !propertyName || className.toLowerCase() !== currentClassName.toLowerCase()) {
        this.errors.push(`Failed to process header as property: ${member.name}`);
        return;
      }
      currentClassMembers.push(Documentation.Member.createProperty(propertyName));
    }

    function handleEvent(member, eventName) {
      if (!currentClassName || !eventName) {
        this.errors.push(`Failed to process header as event: ${member.name}`);
        return;
      }
      currentClassMembers.push(Documentation.Member.createEvent(eventName));
    }

    function flushClassIfNeeded() {
      if (currentClassName === null)
        return;
      this.classes.push(new Documentation.Class(currentClassName, currentClassMembers));
      currentClassName = null;
      currentClassMembers = [];
    }
  }
}

/**
 * @param {!Page} page
 * @param {!Array<string>} dirPath
 * @return {!Promise<{documentation: !Documentation, errors: !Array<string>}>}
 */
module.exports = async function(page, dirPath) {
  let filePaths = fs.readdirSync(dirPath)
      .filter(fileName => fileName.endsWith('.md'))
      .map(fileName => path.join(dirPath, fileName));
  let classes = [];
  let errors = [];
  for (let filePath of filePaths) {
    const markdownText = fs.readFileSync(filePath, 'utf8');
    const newMarkdownText = markdownToc.insert(markdownText);
    if (markdownText !== newMarkdownText)
      errors.push('Markdown TOC is outdated, run `yarn generate-toc`');
    let outline = await MDOutline.create(page, markdownText);
    classes.push(...outline.classes);
    errors.push(...outline.errors);
  }
  const documentation = new Documentation(classes);
  return { documentation, errors };
};

