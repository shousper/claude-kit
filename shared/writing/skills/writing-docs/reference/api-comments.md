# API comment reference

## Scope

Comment syntax, such as `///`, `/** */`, or `"""`, follows the convention of the language you are writing in; this file covers only the wording that goes inside those comments.
Give every public class, interface, struct, constant, field, and method a description; for a method, describe every parameter, the return value, and any exception it can throw.
On a reference page for one class, include a short code sample near the top, roughly five to twenty lines, that shows a typical use of the class before diving into member-by-member detail.
Put every API name, class name, method name, constant, and parameter name in code font, and put a string literal in code font enclosed in double quotation marks.

## Class and interface descriptions

Open with one sentence that states the purpose of the class using information the class name alone does not convey, and never restart that sentence with "This class will" or "This class does."
Keep the opening sentence free of a period before its natural end, since some documentation generators cut the summary at the first period they see; write "for example" instead of "e.g." for this reason.
Elaborate afterward on how to construct or obtain an instance, the key operations it exposes, and any pitfalls worth calling out.
Match the class name's exact spelling and capitalization from the source, and refer to multiple instances with a plural noun after the name rather than pluralizing the name itself.

## Member descriptions

Keep the description of a constant or field as brief as possible, and mention any method that reads or sets it so the reader can find the related behavior.

## Method descriptions

Phrase the opening sentence of a method's description in the third person, describing what the method does, not an instruction to the reader: "Creates a new record," not "Create a new record."
Choose the opening verb by what the method does: a getter that returns a boolean starts with "Checks whether"; a getter that returns anything else starts with "Gets the"; a setter starts with "Sets the"; a method with no return value uses a verb matching its effect, such as "Updates the," "Deletes the," or "Registers."
A convenience method that builds and returns a new instance starts with "Creates a."
After the opening sentence, note any preconditions the caller must satisfy, and describe what happens when a precondition is not met.
A callback method, one an implementer overrides rather than calls directly, reads "Called by X when Y," followed by a sentence telling the implementer what to do inside it.

## Parameters

Start a non-boolean parameter's description with "The" or "A," and end it with a period.
For a boolean parameter that controls behavior, state the effect of both the true value and the false value in the same description.
For a boolean parameter that reports an already-established state, use the fixed phrasing "True if condition; false otherwise," without code font or quotation marks around the words true and false.
For a parameter with a default value, describe the effect of each supported value, then name the default using the phrasing "Default: value."

## Return values

Start the description of a non-boolean return value with "The."
Use the same fixed phrasing as boolean parameters for a boolean return value: "True if condition; false otherwise."
Keep the return description brief; move any lengthy explanation into the class or method description instead.

## Exceptions and deprecation

When the generator inserts the word "Throws" automatically, start the exception description with "If"; otherwise start it with "Thrown when."
When you deprecate a member, name its replacement in the first sentence, and name the version the deprecation took effect in a following sentence.

## Example

Before: "This method will get the bird with the given ID and return it."
After: "Gets the bird with the given ID."
