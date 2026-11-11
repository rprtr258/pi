---
name: mine-generic-annotation-free-squares-sum
description: Rewrite the lish-ef example examples/squares_sum.ef so its sumSquares function is generic (one type parameter) with zero type annotations, demonstrated on both integer and float lists.
timeout_s: 120
---

Your workspace starts empty. First, recreate the existing (broken) example program by creating exactly this file:

#### `examples/squares_sum.ef`

```
// squares_sum.ef — sum the squares of a list of numbers.

fn sumSquares<T: Num>(xs: List<T>): T {
  let total: T = 0
  for x in xs {
    total = total + x * x
  }
  return total
}

print(sumSquares(range(1, 11)))
```

Once this file exists, the task is:

This workspace contains an example program for **lish-ef**, a tiny dynamically typed language. Example files follow this grammar:

- Top-level forms: `fn` definitions and expression statements (e.g. `print(...)` calls).
- A function is written `fn name<T, U>(arg1, arg2) { ... }`. The `<...>` type-parameter list is what makes a function generic. The grammar also permits optional sugar: argument annotations (`arg: Type`), a return annotation (`): Type`), and bounds on type parameters (`<T: Num>`), but this sugar is discouraged and must not be used in this task.
- Inside a block you may use `let name = expr`, reassign with `name = expr`, loop with `for x in expr { ... }`, `return expr`, or leave a bare expression; the last expression of a block is its value.
- Builtins: `print(v)`, `range(a, b)` (list of ints from a inclusive to b exclusive), arithmetic `+ - * /`, comparisons. Literals: integers, floats like `1.5`, lists like `[1, 2, 3]`. Comments start with `//`. There are no string literals and no other syntax.

Rewrite `examples/squares_sum.ef` so that ALL of the following hold:

1. It defines exactly one function, named `sumSquares`, taking exactly one argument, and it is generic: it declares exactly one type parameter in `<...>`.
2. The file contains no type annotations at all — no argument annotations, no return annotation, no bound on the type parameter. In fact, excluding comments, the file must not contain a single `:` character.
3. The file must not mention any concrete type name (Int, Float, Num, Number, List, Array, String, Bool, Vector) anywhere outside comments.
4. The function computes the sum of the squares of the elements of its argument using only operations valid for any numeric type (no bit tricks like `^`, `<<`, `>>`). The literals `385` and `17.5` must not appear anywhere in the file (no hardcoding results).
5. After the function definition, at top level, the file prints two demonstrations of the generic behavior:
   - `print(sumSquares(range(1, 11)))`
   - `print(sumSquares([1.5, 2.5, 3.0]))`

Do not create or modify any other files.
