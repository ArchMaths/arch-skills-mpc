// Arch reports problems in Chinese. The tool passes Arch's message on with an English version
// in front. The first matching phrase wins, so longer phrases come before phrases they contain.
export const ARCH_MESSAGES = [
    ['输入的表达式有误，请检查语法', 'syntax error in expression'],
    ['未创建新对象，请检查语法与重名情况', 'nothing was created; check syntax and duplicate names'],
    ['数学表达式不能包含 multi 批量串、访问浏览器对象或执行脚本', 'Arch does not accept $multi strings, browser objects or code in expressions'],
    // Parametric curves and surfaces (Arch 12201+).
    ['参数区间声明必须以 } 结束', 'the {parameter,min,max} range must end the line'],
    ['参数区间格式为', 'write the range as {u,min,max}, or {u,min,max,v,min,max} for a surface'],
    ['参数坐标必须依次为', 'the coordinates must be x=, y= and optionally z=, in that order'],
    ['参数数组需要', 'a parametric tuple has 2, 3, 5, 6 or 9 items: the coordinates, then name,min,max for each parameter'],
    ['参数坐标表达式不能为空', 'a coordinate expression is empty'],
    ['参数曲面必须有三个坐标和两个参数声明', 'a parametric surface needs three coordinates and two parameter ranges'],
    ['参数名必须是非保留的字母或下划线开头的标识符', 'a parameter name must be a plain name that is not reserved (x, y, z, e, pi, built-in functions, sum, prod, int, diff, diffat)'],
    ['曲面的两个参数不能重名', 'the two parameters of a surface need different names'],
    ['参数区间上下限不能为空', 'a range bound is empty'],
    ['curve 需要一个参数', 'curve(...) takes exactly one parameter range; use surface(...) for two'],
    ['surface 需要三个坐标和两个参数区间声明', 'surface(...) needs three coordinates and two parameter ranges'],
    ['存档中的参数曲线或参数曲面语法无效', 'the saved parametric curve or surface is invalid'],
    ['无效的参数曲线或参数曲面', 'invalid parametric curve or surface'],
    ['区间上下限不能依赖自身参数', 'a range bound cannot use its own parameter'],
    ['参数区间须为有限数值且下限小于上限', 'each parameter range must be finite with min < max'],
    ['参数区间无法计算', 'the parameter range cannot be computed'],
    ['参数表达式括号不匹配', 'unbalanced brackets'],
    ['括号不匹配', 'unbalanced brackets'],
    ['编译错误', 'compile error'],
    // The ArchScript sandbox that runs operators and @script (Arch 12201+).
    ['ArchScript 安全限制', 'blocked by Arch\'s script sandbox'],
    ['全局脚本错误', 'error in @script'],
    ['脚本错误', 'script error']
];

export function translateArchMessage(message, table = ARCH_MESSAGES) {
    const text = String(message);
    for (const [zh, en] of table) if (text.includes(zh)) return `${en} (${text})`;
    return text;
}
