# HTML Forms Reference

## Decision Table

| Goal                              | Use                                              | Notes                                              |
| --------------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| Associate label with control      | `<label for="id">` + `id` on input               | Always explicit; never placeholder-only            |
| Group related controls            | `<fieldset>` + `<legend>`                        | Required for radio/checkbox groups                 |
| Specific keyboard/validation type | `type="email"`, `tel`, `url`, `number`, `search` | Triggers correct mobile keyboard and native hints  |
| Enable autofill                   | `autocomplete="..."`                             | Use specific values (`given-name`, `email`, `tel`) |
| Native required validation        | `required`                                       | Avoid JS-only validation for basic presence checks |
| Pattern-based validation          | `pattern="[A-Z]{3}"`                             | Add `title` to explain the pattern                 |
| Link error message to input       | `aria-describedby="error-id"` on input           | Error `id` must match                              |
| Mark invalid field                | `aria-invalid="true"`                            | Set dynamically after failed validation            |
| Close dialog on submit without JS | `<form method="dialog">`                         | Returns `value` of the submit button               |

## Label Patterns

Every control must have a visible, programmatically associated label.

**Good:**

```html
<label for="email">Email address</label>
<input type="email" id="email" name="email" autocomplete="email" required />
```

**Bad:**

```html
<input type="email" placeholder="Email address" />
```

Placeholders disappear on input and are not a substitute for labels.

## Fieldset and Legend

Use `<fieldset>` + `<legend>` for any group of related controls.

```html
<fieldset>
  <legend>Notification preferences</legend>

  <label> <input type="checkbox" name="notify" value="email" /> Email </label>
  <label> <input type="checkbox" name="notify" value="sms" /> SMS </label>
</fieldset>
```

For radio groups, `<fieldset>` is not optional — it is the only way to give the group a name accessible to screen readers.

## Input Types

Use the most specific type available:

```html
<input type="email" autocomplete="email" />
<input type="tel" autocomplete="tel" />
<input type="url" autocomplete="url" />
<input type="number" min="0" max="100" />
<input type="search" name="q" />
<input type="date" />
<input type="password" autocomplete="current-password" />
```

## Autocomplete Values

Provide specific `autocomplete` values to enable browser autofill and assist users with cognitive disabilities.

```html
<input type="text" id="name" autocomplete="name" />
<input type="text" id="given" autocomplete="given-name" />
<input type="text" id="family" autocomplete="family-name" />
<input type="email" id="email" autocomplete="email" />
<input type="tel" id="phone" autocomplete="tel" />
<input type="text" id="street" autocomplete="street-address" />
<input type="text" id="city" autocomplete="address-level2" />
<input type="text" id="postcode" autocomplete="postal-code" />
<input type="password" id="pass" autocomplete="current-password" />
<input type="password" id="new-pass" autocomplete="new-password" />
```

## Error States

Link error messages to the input with `aria-describedby`. Set `aria-invalid="true"` on the field.

```html
<label for="email">Email address</label>
<input
  type="email"
  id="email"
  name="email"
  aria-describedby="email-error"
  aria-invalid="true"
/>
<p id="email-error" role="alert">Enter a valid email address.</p>
```

## Native Constraint Validation

Use HTML attributes before writing JavaScript validation logic:

```html
<input type="text" required minlength="2" maxlength="80" />
<input type="number" min="1" max="999" step="1" />
<input
  type="text"
  pattern="[A-Z]{2}[0-9]{4}"
  title="Two uppercase letters followed by four digits"
/>
```

## Submit Button

Always include an explicit submit button. Do not use `<div>` or `<a>` as submit triggers.

```html
<button type="submit">Save project</button>
```

Use `type="button"` for non-submit actions inside a form to prevent accidental submission:

```html
<button type="button" id="preview-btn">Preview</button>
```
