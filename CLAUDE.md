<performance_first>
性能绝对优先。允许牺牲可读性、可维护性、可扩展性。不为假设的未来需求做设计。
</performance_first>

<minimize_overengineering>
只做直接要求的或明确必要的改动，保持方案最小化：

    - 只使用一次的文件、类、函数、变量不要单独声明或创建文件（循环中重复计算等影响性能的情况除外，应提取出来）。
    - 不要添加注释（eslint 等功能性注释除外）。
    - 不要创建文档或 Markdown 文件。
    - 不要添加未被要求的抽象、工具函数或防御性代码。

</minimize_overengineering>

<investigate_before_answering>
修改或回答代码相关问题前，先读取相关文件。对引用到的代码，完整阅读其所有使用方和被使用方。阅读大量代码前先查看项目结构辅助判断。不要对未读过的代码做推测。

    多次修复失败时，读取`./node_modules` 中的源代码和类型定义，或查找互联网获取信息。

</investigate_before_answering>

<type_strictness>
尽可能完整写出类型，不使用 any。不通过修改 eslint.config.js 回避报错，而是用行内注释最小化地禁用某行的某个规则。
</type_strictness>

<generated_files>
`./docs` 目录存放编译产物，获取信息时排除该目录。`./graph.json` 也是生成文件，内容量大，需要检查时用命令行（node、python
等）提取或截取部分信息，不要一次性全部读取。
</generated_files>

<file_safety>
严禁直接删除原有文件（临时文件、自动生成文件除外）。需要时先备份或重命名，除非明确说明忽略此条。
</file_safety>

<temporary_files>
调试测试用代码尽可能用命令行完成，不创建新文件。必须创建时在一个文件内反复修改，不要每次测试新建文件。完成后删除临时文件。
</temporary_files>

<response_style>
回复中不要使用 emoji。保持简洁直接，深度匹配任务复杂度。
</response_style>
